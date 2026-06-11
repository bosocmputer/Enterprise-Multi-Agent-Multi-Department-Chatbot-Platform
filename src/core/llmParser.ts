import { createHash } from "node:crypto";
import { z } from "zod";
import type pino from "pino";
import {
  actionForLegacyIntent,
  legacyIntentForAction,
  normalizeDomainProfile,
  type BusinessProfile
} from "../config/businessProfile.js";
import type { LiteLlmClient } from "../integrations/litellmClient.js";
import { LiteLlmClientError } from "../integrations/litellmClient.js";
import type { MetricsRegistry } from "../observability/metrics.js";
import type { LookupActionId, LookupIntent } from "./types.js";

const llmParseJsonSchema = z
  .object({
    action: z.string().trim().min(1).optional(),
    confidence: z.number().min(0).max(1),
    entityType: z.string().trim().min(1).optional(),
    intent: z.enum(["search_product", "stock", "price", "stock_price", "unsupported"]).optional(),
    keyword: z.string().optional(),
    query: z.string().optional(),
    searchTerms: z.array(z.string().trim().min(1)).min(1).max(5)
  })
  .passthrough();

export type LlmParserMode = "off" | "shadow" | "assist";

export type LlmParseRejectionReason =
  | "empty_keyword"
  | "invalid_json"
  | "invalid_schema"
  | "low_confidence"
  | "provider_error"
  | "queue_timeout"
  | "truncated"
  | "timeout";

export interface LlmParserMetadata {
  model: string;
  provider: string;
  timeoutMs: number;
}

export interface LlmParseTelemetry {
  durationMs?: number;
  outcome?: string;
}

export type LlmParseResult =
  | {
      confidence: number;
      action?: LookupActionId;
      entityType?: string;
      intent: LookupIntent | "unsupported";
      keyword: string;
      model?: string;
      query: string;
      searchTerms: string[];
      status: "parsed";
    } & LlmParseTelemetry
  | {
      model?: string;
      reason: LlmParseRejectionReason;
      status: "rejected";
    } & LlmParseTelemetry;

export interface LookupLlmParser {
  metadata?: LlmParserMetadata;
  parse(text: string): Promise<LlmParseResult>;
}

export interface ThrottledLlmParserOptions {
  maxConcurrentCalls: number;
  parser: LookupLlmParser;
  queueWaitMs: number;
}

export interface BusinessProfileLlmParserOptions {
  client: LiteLlmClient;
  metadata: LlmParserMetadata;
  minConfidence: number;
  profile: BusinessProfile;
}

export interface LlmParseTelemetryOptions {
  logger?: pino.Logger;
  metrics?: MetricsRegistry;
  mode: LlmParserMode;
}

export class BusinessProfileLlmParser implements LookupLlmParser {
  readonly metadata: LlmParserMetadata;

  constructor(private readonly options: BusinessProfileLlmParserOptions) {
    this.metadata = options.metadata;
  }

  async parse(text: string): Promise<LlmParseResult> {
    try {
      const completion = await this.options.client.createJsonChatCompletion(buildMessages(text, this.options.profile));
      if (completion.finishReason === "length") {
        return { model: completion.model ?? this.metadata.model, reason: "truncated", status: "rejected" };
      }
      let decoded: unknown;
      try {
        decoded = JSON.parse(completion.content);
      } catch {
        return { model: completion.model, reason: "invalid_json", status: "rejected" };
      }

      const parsed = llmParseJsonSchema.safeParse(decoded);
      if (!parsed.success) {
        return { model: completion.model, reason: "invalid_schema", status: "rejected" };
      }

      const normalized = normalizeParsedLlmOutput(parsed.data, this.options.profile);
      if (!normalized) {
        return { model: completion.model, reason: "invalid_schema", status: "rejected" };
      }

      if (!normalized.query.trim()) {
        return { model: completion.model, reason: "empty_keyword", status: "rejected" };
      }

      if (parsed.data.confidence < this.options.minConfidence) {
        return { model: completion.model, reason: "low_confidence", status: "rejected" };
      }

      return {
        action: normalized.action,
        confidence: parsed.data.confidence,
        entityType: normalized.entityType,
        intent: normalized.intent,
        keyword: normalized.query,
        model: completion.model ?? this.metadata.model,
        query: normalized.query,
        searchTerms: normalizeSearchTerms(normalized.query, parsed.data.searchTerms),
        status: "parsed"
      };
    } catch (error) {
      if (error instanceof LiteLlmClientError && error.code === "timeout") {
        return { model: this.metadata.model, reason: "timeout", status: "rejected" };
      }
      return { model: this.metadata.model, reason: "provider_error", status: "rejected" };
    }
  }
}

export class ThrottledLlmParser implements LookupLlmParser {
  readonly metadata: LlmParserMetadata | undefined;
  private activeCalls = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly options: ThrottledLlmParserOptions) {
    this.metadata = options.parser.metadata;
  }

  async parse(text: string): Promise<LlmParseResult> {
    const acquired = await this.acquireSlot();
    if (!acquired) {
      return {
        model: this.metadata?.model,
        reason: "queue_timeout",
        status: "rejected"
      };
    }

    try {
      return await this.options.parser.parse(text);
    } finally {
      this.releaseSlot();
    }
  }

  private async acquireSlot(): Promise<boolean> {
    const maxConcurrent = Math.max(1, this.options.maxConcurrentCalls);
    if (this.activeCalls < maxConcurrent) {
      this.activeCalls += 1;
      return true;
    }

    const queueWaitMs = Math.max(0, this.options.queueWaitMs);
    if (queueWaitMs === 0) return false;

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const grantSlot = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(true);
      };
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        const index = this.waiters.indexOf(grantSlot);
        if (index >= 0) this.waiters.splice(index, 1);
        resolve(false);
      }, queueWaitMs);
      this.waiters.push(grantSlot);
    });
  }

  private releaseSlot(): void {
    const next = this.waiters.shift();
    if (next) {
      next();
      return;
    }
    this.activeCalls = Math.max(0, this.activeCalls - 1);
  }
}

export async function runLlmParseWithTelemetry(
  parser: LookupLlmParser,
  text: string,
  options: LlmParseTelemetryOptions
): Promise<LlmParseResult> {
  const startedAt = Date.now();
  const result = await parser.parse(text).catch((): LlmParseResult => {
    return {
      model: parser.metadata?.model,
      reason: "provider_error",
      status: "rejected"
    };
  });
  const durationMs = Date.now() - startedAt;
  const outcome = llmParseOutcome(result);
  const resultWithTelemetry = { ...result, durationMs, outcome } as LlmParseResult;

  options.metrics?.recordLlmParse(options.mode, result.model ?? "unknown", outcome, durationMs);
  options.logger?.info(
    {
      confidence: result.status === "parsed" ? result.confidence : undefined,
      action: result.status === "parsed" ? result.action : undefined,
      durationMs,
      entityType: result.status === "parsed" ? result.entityType : undefined,
      intent: result.status === "parsed" ? result.intent : undefined,
      mode: options.mode,
      model: result.model,
      outcome,
      textHash: hashText(text)
    },
    "llm parser completed"
  );

  return resultWithTelemetry;
}

export function llmParseOutcome(result: LlmParseResult): string {
  if (result.status === "parsed") return result.intent === "unsupported" ? "unsupported" : "parsed";
  return `rejected_${result.reason}`;
}

function buildMessages(text: string, profile: BusinessProfile) {
  const domain = normalizeDomainProfile(profile);
  const examples = profile.examples.slice(0, 3).map((example) => ({
    action: actionForLegacyIntent(profile, example.intent)?.id,
    query: example.keyword,
    text: example.text
  }));
  return [
    {
      role: "system" as const,
      content:
        "You are a strict JSON parser for Thai business lookup messages. Output JSON only. No reasoning. No prose. " +
        "Do not answer business facts or choose a result. Map the message to an allowed action and entity type only. " +
        'Schema: {"action":"allowed action id","entityType":"allowed entity type","query":"string","confidence":0.0,"searchTerms":["string"]}. ' +
        "Use searchTerms only as possible source-system lookup terms. If unsupported, use intent=unsupported."
    },
    {
      role: "user" as const,
      content: JSON.stringify({
        actions: domain.actions.map((action) => ({
          id: action.id,
          legacyIntent: action.legacyIntent,
          phrases: action.phrases.slice(0, 8)
        })),
        defaultEntityType: domain.defaultEntityType,
        entityTypes: domain.entities.map((entity) => entity.type),
        examples,
        knownAliases: profile.aliases.flatMap((alias) => [alias.from, ...alias.to]).slice(0, 20),
        locale: profile.locale,
        text
      })
    }
  ];
}

function normalizeParsedLlmOutput(
  data: z.infer<typeof llmParseJsonSchema>,
  profile: BusinessProfile
):
  | {
      action?: LookupActionId;
      entityType: string;
      intent: LookupIntent | "unsupported";
      query: string;
    }
  | undefined {
  const domain = normalizeDomainProfile(profile);
  const allowedEntityTypes = new Set([
    domain.defaultEntityType,
    ...domain.entities.map((entity) => entity.type),
    ...domain.actions.flatMap((action) => action.entityTypes)
  ]);
  const query = (data.query ?? data.keyword ?? "").trim();
  const requestedAction = data.action?.trim();
  const action = requestedAction ? domain.actions.find((item) => item.id === requestedAction) : undefined;
  if (requestedAction && !action) return undefined;

  const intentFromAction = action ? legacyIntentForAction(profile, action.id) : undefined;
  const intentFromPayload = data.intent;
  if (!intentFromPayload && !intentFromAction) return undefined;
  if (intentFromPayload === "unsupported") {
    return {
      entityType: normalizeEntityType(data.entityType, allowedEntityTypes, domain.defaultEntityType) ?? domain.defaultEntityType,
      intent: "unsupported",
      query
    };
  }
  if (intentFromPayload && intentFromAction && intentFromPayload !== intentFromAction) return undefined;

  const intent = intentFromPayload ?? intentFromAction;
  if (!intent) return undefined;

  const entityType =
    normalizeEntityType(data.entityType, allowedEntityTypes, domain.defaultEntityType) ??
    action?.entityTypes[0] ??
    domain.defaultEntityType;
  if (data.entityType && !allowedEntityTypes.has(data.entityType)) return undefined;

  return {
    action: action?.id ?? actionForLegacyIntent(profile, intent)?.id,
    entityType,
    intent,
    query
  };
}

function normalizeEntityType(
  value: string | undefined,
  allowedEntityTypes: Set<string>,
  defaultValue: string
): string | undefined {
  if (!value) return defaultValue;
  return allowedEntityTypes.has(value) ? value : undefined;
}

function normalizeSearchTerms(keyword: string, searchTerms: string[]): string[] {
  const terms = new Set<string>([keyword, ...searchTerms].map((term) => term.trim()).filter(Boolean));
  return [...terms].slice(0, 5);
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}
