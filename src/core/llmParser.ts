import { createHash } from "node:crypto";
import { z } from "zod";
import type pino from "pino";
import type { BusinessProfile } from "../config/businessProfile.js";
import type { LiteLlmClient } from "../integrations/litellmClient.js";
import { LiteLlmClientError } from "../integrations/litellmClient.js";
import type { MetricsRegistry } from "../observability/metrics.js";
import type { LookupIntent } from "./types.js";

const llmParseJsonSchema = z
  .object({
    confidence: z.number().min(0).max(1),
    intent: z.enum(["search_product", "stock", "price", "stock_price", "unsupported"]),
    keyword: z.string().trim().min(1),
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
      intent: LookupIntent | "unsupported";
      keyword: string;
      model?: string;
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

      if (!parsed.data.keyword.trim()) {
        return { model: completion.model, reason: "empty_keyword", status: "rejected" };
      }

      if (parsed.data.confidence < this.options.minConfidence) {
        return { model: completion.model, reason: "low_confidence", status: "rejected" };
      }

      return {
        confidence: parsed.data.confidence,
        intent: parsed.data.intent,
        keyword: parsed.data.keyword,
        model: completion.model ?? this.metadata.model,
        searchTerms: normalizeSearchTerms(parsed.data.keyword, parsed.data.searchTerms),
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
      durationMs,
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
  return [
    {
      role: "system" as const,
      content:
        "You are a strict JSON parser for Thai inventory lookup messages. Output JSON only. No reasoning. No prose. " +
        "Do not answer product facts, stock, or price. Allowed intents: search_product, stock, price, stock_price, unsupported. " +
        'Schema: {"intent":"search_product|stock|price|stock_price|unsupported","keyword":"string","confidence":0.0,"searchTerms":["string"]}. ' +
        "Use aliases/searchTerms only as possible SML catalog search terms."
    },
    {
      role: "user" as const,
      content: JSON.stringify({
        businessType: profile.businessType,
        enabledIntents: profile.enabledIntents,
        examples: profile.examples.slice(0, 3),
        knownAliases: profile.aliases.flatMap((alias) => [alias.from, ...alias.to]).slice(0, 20),
        locale: profile.locale,
        text
      })
    }
  ];
}

function normalizeSearchTerms(keyword: string, searchTerms: string[]): string[] {
  const terms = new Set<string>([keyword, ...searchTerms].map((term) => term.trim()).filter(Boolean));
  return [...terms].slice(0, 5);
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}
