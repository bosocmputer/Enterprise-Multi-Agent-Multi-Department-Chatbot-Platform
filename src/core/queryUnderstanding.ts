import type pino from "pino";
import type { BusinessProfile } from "../config/businessProfile.js";
import type { MetricsRegistry } from "../observability/metrics.js";
import type { LlmParserMode, LookupLlmParser } from "./llmParser.js";
import { runLlmParseWithTelemetry } from "./llmParser.js";
import { parseLookupQuery } from "./queryParser.js";
import type { ParseOutcome } from "./types.js";

const exactCodePattern = /^[A-Z0-9][A-Z0-9_-]{2,}$/i;

export interface QueryUnderstandingOptions {
  llmParser?: LookupLlmParser;
  llmParserMode: LlmParserMode;
  logger?: pino.Logger;
  metrics?: MetricsRegistry;
}

export async function understandLookupQuery(
  text: string,
  profile: BusinessProfile,
  options: QueryUnderstandingOptions
): Promise<ParseOutcome> {
  const deterministic = parseLookupQuery(text, profile);
  if (deterministic.status === "parsed") return deterministic;
  if (options.llmParserMode !== "assist" || !options.llmParser) return deterministic;

  const llmParsed = await runLlmParseWithTelemetry(options.llmParser, text, {
    logger: options.logger,
    metrics: options.metrics,
    mode: "assist"
  });
  if (llmParsed.status !== "parsed" || llmParsed.intent === "unsupported") return deterministic;
  if (!profile.enabledIntents.includes(llmParsed.intent)) return deterministic;

  return {
    status: "parsed",
    intent: llmParsed.intent,
    keyword: llmParsed.keyword,
    isExactCode: exactCodePattern.test(llmParsed.keyword),
    searchTerms: llmParsed.searchTerms,
    source: "llm"
  };
}
