import type pino from "pino";
import type { BusinessProfile } from "../config/businessProfile.js";
import type { MetricsRegistry } from "../observability/metrics.js";
import type { LlmParseResult, LlmParserMode, LookupLlmParser } from "./llmParser.js";
import { llmParseOutcome, runLlmParseWithTelemetry } from "./llmParser.js";
import { classifyCapabilityGapText } from "./capabilityClassifier.js";
import {
  classifyNonLookupText,
  friendlyUnsupportedReason,
  isOutOfScopeKind,
  metadataForNonLookupKind
} from "./nonLookupGuard.js";
import { parseLookupQuery } from "./queryParser.js";
import type { LlmAssistInfo, LlmAssistReason, LlmAssistStartEvent, ParseOutcome } from "./types.js";

const exactCodePattern = /^[A-Z0-9][A-Z0-9_-]{2,}$/i;

export interface QueryUnderstandingOptions {
  llmParser?: LookupLlmParser;
  llmParserMode: LlmParserMode;
  logger?: pino.Logger;
  metrics?: MetricsRegistry;
  onAssistStart?: (event: LlmAssistStartEvent) => void | Promise<void>;
}

export async function understandLookupQuery(
  text: string,
  profile: BusinessProfile,
  options: QueryUnderstandingOptions
): Promise<ParseOutcome> {
  const preParserNonLookup = classifyNonLookupText(text);
  if (
    isOutOfScopeKind(preParserNonLookup) ||
    preParserNonLookup === "lookup_coaching" ||
    preParserNonLookup === "recommendation_guidance"
  ) {
    return {
      status: "unsupported",
      reason: friendlyUnsupportedReason(preParserNonLookup),
      ...metadataForNonLookupKind(preParserNonLookup)
    };
  }

  const capabilityGap = classifyCapabilityGapText(text, profile);
  if (capabilityGap) {
    return {
      status: "capability_gap",
      ...capabilityGap,
      conversationScope: "lookup_like",
      outOfScopeCategory: "none",
      parserPath: "deterministic",
      replyPolicy: "lookup"
    };
  }

  const deterministic = parseLookupQuery(text, profile);
  if (deterministic.status === "parsed") {
    return {
      ...deterministic,
      conversationScope: "lookup_like",
      outOfScopeCategory: "none",
      parserPath: "deterministic",
      replyPolicy: "lookup"
    };
  }
  const nonLookup = preParserNonLookup;
  if (nonLookup) {
    return {
      status: "unsupported",
      reason: friendlyUnsupportedReason(nonLookup),
      ...metadataForNonLookupKind(nonLookup)
    };
  }
  if (options.llmParserMode !== "assist" || !options.llmParser) return deterministic;

  const assistStart = startAssist(options.llmParser, "unsupported", options);
  const llmParsed = await runLlmParseWithTelemetry(options.llmParser, text, {
    logger: options.logger,
    metrics: options.metrics,
    mode: "assist"
  });
  const assist = assistInfo(assistStart, llmParsed);
  if (llmParsed.status === "parsed" && llmParsed.capabilityGap) {
    return {
      status: "capability_gap",
      ...llmParsed.capabilityGap,
      assist,
      conversationScope: "lookup_like",
      outOfScopeCategory: "none",
      parserPath: "llm_assist",
      replyPolicy: "lookup"
    };
  }
  if (llmParsed.status !== "parsed" || llmParsed.intent === "unsupported") return { ...deterministic, assist };
  if (!profile.enabledIntents.includes(llmParsed.intent)) {
    return {
      ...deterministic,
      assist: {
        ...assist,
        outcome: "rejected_intent_disabled",
        status: "rejected"
      }
    };
  }

  return {
    status: "parsed",
    action: llmParsed.action,
    entityType: llmParsed.entityType,
    intent: llmParsed.intent,
    keyword: llmParsed.keyword,
    isExactCode: exactCodePattern.test(llmParsed.keyword),
    query: llmParsed.query,
    searchTerms: llmParsed.searchTerms,
    assist,
    source: "llm",
    conversationScope: "lookup_like",
    outOfScopeCategory: "none",
    parserPath: "llm_assist",
    replyPolicy: "lookup"
  };
}

export function startAssist(
  parser: LookupLlmParser,
  reason: LlmAssistReason,
  options: Pick<QueryUnderstandingOptions, "llmParserMode" | "metrics" | "onAssistStart">
): LlmAssistStartEvent {
  const metadata = parser.metadata ?? {
    model: "unknown",
    provider: "unknown",
    timeoutMs: 0
  };
  const event: LlmAssistStartEvent = {
    model: metadata.model,
    provider: metadata.provider,
    reason,
    timeoutMs: metadata.timeoutMs
  };
  options.metrics?.recordLlmAssistStarted(options.llmParserMode, event.model, reason);
  try {
    void Promise.resolve(options.onAssistStart?.(event)).catch(() => undefined);
  } catch {
    // Assist status is best-effort and must never block lookup.
  }
  return event;
}

export function assistInfo(started: LlmAssistStartEvent, result: LlmParseResult): LlmAssistInfo {
  return {
    durationMs: result.durationMs,
    model: result.model ?? started.model,
    outcome: result.outcome ?? llmParseOutcome(result),
    provider: started.provider,
    reason: started.reason,
    status: result.status === "parsed" && (result.intent !== "unsupported" || Boolean(result.capabilityGap)) ? "parsed" : "rejected",
    timeoutMs: started.timeoutMs
  };
}
