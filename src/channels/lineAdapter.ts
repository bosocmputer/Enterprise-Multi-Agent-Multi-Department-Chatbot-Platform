import { createHmac, timingSafeEqual } from "node:crypto";
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

const lineEventSchema = z
  .object({
    type: z.string(),
    replyToken: z.string().optional(),
    webhookEventId: z.string().optional(),
    source: z
      .object({
        type: z.enum(["user", "group", "room"]),
        userId: z.string().optional(),
        groupId: z.string().optional(),
        roomId: z.string().optional()
      })
      .passthrough(),
    message: z
      .object({
        id: z.string().optional(),
        type: z.string(),
        text: z.string().optional(),
        mention: z
          .object({
            mentionees: z
              .array(
                z
                  .object({
                    index: z.number().optional(),
                    length: z.number().optional(),
                    isSelf: z.boolean().optional()
                  })
                  .passthrough()
              )
              .default([])
          })
          .optional()
      })
      .passthrough()
      .optional()
  })
  .passthrough();

const lineWebhookSchema = z
  .object({
    events: z.array(lineEventSchema).default([])
  })
  .passthrough();

export interface LineAdapterOptions {
  alerts?: AlertSender;
  businessProfile: BusinessProfile;
  channelAccessToken: string;
  channelSecret: string;
  contextStore?: CacheService;
  contextTtlSeconds?: number;
  dedupStore?: DedupStore;
  dedupTtlSeconds?: number;
  fetchImpl?: typeof fetch;
  groupPrefixes: string[];
  logger?: pino.Logger;
  metrics?: MetricsRegistry;
  rateLimiter?: RateLimiter;
  rateLimitPerMinute?: number;
}

export interface LineHandleResult {
  handled: number;
  ignored: number;
}

export class LineAdapter {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: LineAdapterOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  verifySignature(rawBody: string, signature: string | string[] | undefined): boolean {
    const value = Array.isArray(signature) ? signature[0] : signature;
    if (!value) return false;
    const expected = createHmac("sha256", this.options.channelSecret).update(rawBody).digest("base64");
    const actualBuffer = Buffer.from(value);
    const expectedBuffer = Buffer.from(expected);
    return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
  }

  async handleWebhook(body: unknown, lookup: LookupOrchestrator): Promise<LineHandleResult> {
    const webhook = lineWebhookSchema.parse(body);
    let handled = 0;
    let ignored = 0;

    for (const event of webhook.events) {
      const result = await this.handleEvent(event, lookup);
      if (result) handled += 1;
      else ignored += 1;
    }

    return { handled, ignored };
  }

  private async handleEvent(event: z.infer<typeof lineEventSchema>, lookup: LookupOrchestrator): Promise<boolean> {
    const dedupId = event.webhookEventId ?? event.replyToken ?? event.message?.id;
    if (dedupId && this.options.dedupStore) {
      const claimed = await this.options.dedupStore.claim(`line:event:${dedupId}`, this.options.dedupTtlSeconds ?? 900);
      if (!claimed) {
        this.options.metrics?.recordChannelUpdate("line", "ignored", "duplicate");
        return false;
      }
    }

    if (event.type !== "message" || event.message?.type !== "text" || !event.message.text || !event.replyToken) {
      this.options.metrics?.recordChannelUpdate("line", "ignored", "non_text");
      return false;
    }

    const gatedText = this.textAfterGroupGate(event);
    if (!gatedText) {
      this.options.metrics?.recordChannelUpdate("line", "ignored", "group_gate");
      return false;
    }

    const chatId = event.source.groupId ?? event.source.roomId ?? event.source.userId ?? "unknown";
    const userId = event.source.userId ?? "unknown";
    if (this.options.rateLimiter) {
      const rate = await this.options.rateLimiter.consume(
        `line:rate:${chatId}:${userId}`,
        this.options.rateLimitPerMinute ?? 20,
        60
      );
      if (!rate.allowed) {
        this.options.metrics?.recordChannelUpdate("line", "ignored", "rate_limited");
        return false;
      }
    }

    const contextKey = `line:context:${chatId}:${userId}`;
    const resolved = await resolveTextWithContext({
      businessProfile: this.options.businessProfile,
      contextStore: this.options.contextStore,
      key: contextKey,
      text: gatedText
    });
    if (resolved.kind === "reply") {
      await this.reply(event.replyToken, resolved.text);
      this.options.metrics?.recordChannelUpdate("line", "handled", "context_reply");
      return true;
    }

    const result = await runLookupWithTelemetry(
      lookup,
      {
        text: resolved.text,
        channel: "line",
        chatId,
        userId
      },
      { logger: this.options.logger, metrics: this.options.metrics }
    );
    await saveLookupContext({
      contextStore: this.options.contextStore,
      key: contextKey,
      result,
      ttlSeconds: this.options.contextTtlSeconds ?? 300
    });
    await this.reply(event.replyToken, formatLookupReply(result, this.options.businessProfile));
    await alertOnLookupDependencyError(this.options.alerts, "line", result);
    this.options.metrics?.recordChannelUpdate("line", "handled");
    return true;
  }

  private textAfterGroupGate(event: z.infer<typeof lineEventSchema>): string | undefined {
    const rawText = event.message?.text?.trim() ?? "";
    if (event.source.type === "user") return rawText;

    const withoutMention = removeSelfMentions(rawText, event.message?.mention?.mentionees ?? []).trim();
    const prefix = this.options.groupPrefixes.find((candidate) => withoutMention.startsWith(candidate));
    if (prefix) return withoutMention.slice(prefix.length).trim();

    const mentioned = event.message?.mention?.mentionees?.some((mention) => mention.isSelf);
    if (mentioned) return withoutMention;

    return undefined;
  }

  private async reply(replyToken: string, text: string): Promise<void> {
    const response = await this.fetchImpl("https://api.line.me/v2/bot/message/reply", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.options.channelAccessToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        messages: [{ text, type: "text" }],
        replyToken
      })
    });

    if (!response.ok) {
      await this.options.alerts?.send("line_reply_failed", `LINE reply failed with HTTP ${response.status}`);
      throw new Error(`LINE reply failed with HTTP ${response.status}`);
    }
  }
}

function removeSelfMentions(
  text: string,
  mentionees: Array<{ index?: number; length?: number; isSelf?: boolean }>
): string {
  return mentionees
    .filter((mention) => mention.isSelf && mention.index != null && mention.length != null)
    .sort((a, b) => (b.index ?? 0) - (a.index ?? 0))
    .reduce((current, mention) => {
      const start = mention.index ?? 0;
      const end = start + (mention.length ?? 0);
      return `${current.slice(0, start)} ${current.slice(end)}`;
    }, text);
}
