import type pino from "pino";
import { z } from "zod";
import { alertOnLookupDependencyError, type AlertSender } from "./channelAlerts.js";
import { resolveTextWithContext, saveLookupContext } from "./chatContext.js";
import type { BusinessProfile } from "../config/businessProfile.js";
import type { LookupOrchestrator } from "../core/lookupOrchestrator.js";
import { runLookupWithTelemetry } from "../core/lookupTelemetry.js";
import { formatLookupReply } from "../core/responseFormatter.js";
import type { MetricsRegistry } from "../observability/metrics.js";
import type { CacheService, DedupStore, RateLimiter } from "../services/cacheService.js";

const telegramMessageSchema = z.object({
  message_id: z.number(),
  text: z.string().optional(),
  chat: z.object({
    id: z.union([z.number(), z.string()]),
    type: z.string()
  }),
  from: z
    .object({
      id: z.number().optional(),
      is_bot: z.boolean().optional()
    })
    .optional(),
  reply_to_message: z
    .object({
      from: z
        .object({
          is_bot: z.boolean().optional(),
          username: z.string().optional()
        })
        .optional()
    })
    .optional()
});

const telegramUpdateSchema = z
  .object({
    update_id: z.number(),
    message: telegramMessageSchema.optional()
  })
  .passthrough();

export interface TelegramAdapterOptions {
  botToken: string;
  businessProfile: BusinessProfile;
  alerts?: AlertSender;
  webhookSecret?: string;
  botUsername?: string;
  fetchImpl?: typeof fetch;
  contextStore?: CacheService;
  contextTtlSeconds?: number;
  dedupStore?: DedupStore;
  dedupTtlSeconds?: number;
  logger?: pino.Logger;
  metrics?: MetricsRegistry;
  rateLimiter?: RateLimiter;
  rateLimitPerMinute?: number;
}

export type TelegramUpdateResult =
  | { ignored: false; updateId: number }
  | {
      ignored: true;
      updateId?: number;
      reason: "non_message" | "non_text" | "group_gate" | "duplicate" | "rate_limited";
    };

export class TelegramAdapter {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: TelegramAdapterOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  verifySecret(headerValue: string | string[] | undefined): boolean {
    const value = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    return Boolean(this.options.webhookSecret) && value === this.options.webhookSecret;
  }

  async handleUpdate(body: unknown, lookup: LookupOrchestrator): Promise<TelegramUpdateResult> {
    const update = telegramUpdateSchema.parse(body);

    if (this.options.dedupStore) {
      const claimed = await this.options.dedupStore.claim(
        `telegram:update:${update.update_id}`,
        this.options.dedupTtlSeconds ?? 900
      );
      if (!claimed) {
        this.recordIgnored("duplicate");
        return { ignored: true, updateId: update.update_id, reason: "duplicate" };
      }
    }

    const message = update.message;
    if (!message) {
      this.recordIgnored("non_message");
      return { ignored: true, updateId: update.update_id, reason: "non_message" };
    }
    if (!message.text) {
      this.recordIgnored("non_text");
      return { ignored: true, updateId: update.update_id, reason: "non_text" };
    }
    if (!this.shouldRespond(message)) {
      this.recordIgnored("group_gate");
      return { ignored: true, updateId: update.update_id, reason: "group_gate" };
    }

    if (this.options.rateLimiter) {
      const key = `telegram:rate:${String(message.chat.id)}:${message.from?.id ?? "unknown"}`;
      const rate = await this.options.rateLimiter.consume(key, this.options.rateLimitPerMinute ?? 20, 60);
      if (!rate.allowed) {
        this.recordIgnored("rate_limited");
        return { ignored: true, updateId: update.update_id, reason: "rate_limited" };
      }
    }

    const contextKey = this.contextKey(message);
    const resolved = await resolveTextWithContext({
      businessProfile: this.options.businessProfile,
      contextStore: this.options.contextStore,
      key: contextKey,
      text: message.text
    });
    if (resolved.kind === "reply") {
      await this.sendMessage(String(message.chat.id), resolved.text, message.message_id);
      this.options.metrics?.recordTelegramUpdate("handled", "context_reply");
      return { ignored: false, updateId: update.update_id };
    }

    const result = await runLookupWithTelemetry(
      lookup,
      {
        text: resolved.text,
        channel: "telegram",
        chatId: String(message.chat.id),
        userId: message.from?.id ? String(message.from.id) : undefined
      },
      { logger: this.options.logger, metrics: this.options.metrics }
    );

    await saveLookupContext({
      contextStore: this.options.contextStore,
      key: contextKey,
      result,
      ttlSeconds: this.options.contextTtlSeconds ?? 300
    });
    await this.sendMessage(String(message.chat.id), formatLookupReply(result, this.options.businessProfile), message.message_id);
    await alertOnLookupDependencyError(this.options.alerts, "telegram", result);
    this.options.metrics?.recordTelegramUpdate("handled");
    return { ignored: false, updateId: update.update_id };
  }

  async getUpdates(options: {
    offset?: number;
    timeoutSeconds: number;
    limit?: number;
  }): Promise<unknown[]> {
    const url = `https://api.telegram.org/bot${this.options.botToken}/getUpdates`;
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        allowed_updates: ["message"],
        limit: options.limit ?? 50,
        offset: options.offset,
        timeout: options.timeoutSeconds
      })
    });

    if (!response.ok) {
      throw new Error(`Telegram getUpdates failed with HTTP ${response.status}`);
    }

    const body = (await response.json()) as unknown;
    const parsed = z
      .object({
        ok: z.boolean(),
        result: z.array(z.unknown()).default([])
      })
      .parse(body);

    if (!parsed.ok) {
      throw new Error("Telegram getUpdates returned ok=false");
    }

    return parsed.result;
  }

  private shouldRespond(message: z.infer<typeof telegramMessageSchema>): boolean {
    if (message.chat.type === "private") return true;

    const text = message.text ?? "";
    if (/^\/(?:stock|price|find|search)(?:@\w+)?\b/i.test(text)) return true;

    const username = this.options.botUsername;
    if (username && text.toLowerCase().includes(`@${username.toLowerCase()}`)) return true;

    const replyFrom = message.reply_to_message?.from;
    return Boolean(
      replyFrom?.is_bot && (!username || replyFrom.username?.toLowerCase() === username.toLowerCase())
    );
  }

  private async sendMessage(chatId: string, text: string, replyToMessageId?: number): Promise<void> {
    const url = `https://api.telegram.org/bot${this.options.botToken}/sendMessage`;
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        disable_web_page_preview: true,
        reply_to_message_id: replyToMessageId,
        text
      })
    });

    if (!response.ok) {
      await this.options.alerts?.send("telegram_reply_failed", `Telegram reply failed with HTTP ${response.status}`);
      throw new Error(`Telegram sendMessage failed with HTTP ${response.status}`);
    }
  }

  private contextKey(message: z.infer<typeof telegramMessageSchema>): string {
    return `telegram:context:${String(message.chat.id)}:${message.from?.id ?? "unknown"}`;
  }

  private recordIgnored(reason: Extract<TelegramUpdateResult, { ignored: true }>["reason"]): void {
    this.options.metrics?.recordTelegramUpdate("ignored", reason);
  }
}
