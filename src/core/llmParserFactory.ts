import type { BusinessProfile } from "../config/businessProfile.js";
import type { AppConfig } from "../config/env.js";
import { LiteLlmClient } from "../integrations/litellmClient.js";
import { BusinessProfileLlmParser, ThrottledLlmParser, type LookupLlmParser } from "./llmParser.js";

export function createLlmParser(config: AppConfig, profile: BusinessProfile): LookupLlmParser | undefined {
  const apiKey = config.LITELLM_API_KEY ?? config.OPENAI_API_KEY;
  if (!apiKey) return undefined;

  const parser = new BusinessProfileLlmParser({
    client: new LiteLlmClient({
      apiKey,
      baseUrl: config.LLM_PROVIDER === "openai" ? config.OPENAI_BASE_URL ?? config.LITELLM_BASE_URL : config.LITELLM_BASE_URL,
      model: config.LITELLM_MODEL,
      timeoutMs: config.LLM_PARSER_TIMEOUT_MS
    }),
    metadata: {
      model: config.LITELLM_MODEL,
      provider: config.LLM_PROVIDER,
      timeoutMs: config.LLM_PARSER_TIMEOUT_MS
    },
    minConfidence: config.LLM_MIN_CONFIDENCE,
    profile
  });

  return new ThrottledLlmParser({
    maxConcurrentCalls: config.LLM_MAX_CONCURRENT_CALLS,
    parser,
    queueWaitMs: config.LLM_ASSIST_QUEUE_WAIT_MS
  });
}
