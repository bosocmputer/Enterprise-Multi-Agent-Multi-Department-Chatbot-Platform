import type { BusinessProfile } from "../config/businessProfile.js";
import type { AppConfig } from "../config/env.js";
import { LiteLlmClient } from "../integrations/litellmClient.js";
import { BusinessProfileLlmParser, type LookupLlmParser } from "./llmParser.js";

export function createLlmParser(config: AppConfig, profile: BusinessProfile): LookupLlmParser | undefined {
  const apiKey = config.LITELLM_API_KEY ?? config.OPENAI_API_KEY;
  if (!apiKey) return undefined;

  return new BusinessProfileLlmParser({
    client: new LiteLlmClient({
      apiKey,
      baseUrl: config.LLM_PROVIDER === "openai" ? config.OPENAI_BASE_URL ?? config.LITELLM_BASE_URL : config.LITELLM_BASE_URL,
      model: config.LITELLM_MODEL,
      timeoutMs: config.LLM_PARSER_TIMEOUT_MS
    }),
    minConfidence: config.LLM_MIN_CONFIDENCE,
    profile
  });
}
