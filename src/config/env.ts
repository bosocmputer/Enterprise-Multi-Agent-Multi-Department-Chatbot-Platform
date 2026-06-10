import { z } from "zod";

const booleanFromEnv = z
  .string()
  .optional()
  .transform((value) => {
    if (value == null || value === "") return false;
    return ["1", "true", "yes", "on"].includes(value.toLowerCase());
  });

const numberFromEnv = (defaultValue: number) =>
  z
    .string()
    .optional()
    .transform((value) => {
      if (value == null || value === "") return defaultValue;
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
        throw new Error(`Expected numeric env value, got ${value}`);
      }
      return parsed;
    });

const optionalStringFromEnv = z
  .string()
  .optional()
  .transform((value) => (value == null || value === "" ? undefined : value));

const optionalUrlFromEnv = z
  .string()
  .optional()
  .transform((value) => {
    if (value == null || value === "") return undefined;
    try {
      new URL(value);
      return value;
    } catch {
      throw new Error(`Expected URL env value, got ${value}`);
    }
  });

const csvFromEnv = (defaultValue: string[]) =>
  z
    .string()
    .optional()
    .transform((value) => {
      if (value == null || value === "") return defaultValue;
      return value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    });

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: numberFromEnv(3060),
    LOG_LEVEL: z.string().default("info"),
    APP_VERSION: z.string().default("0.1.0"),
    GIT_SHA: z.string().optional(),
    PUBLIC_BASE_URL: z.string().optional(),
    INTERNAL_API_TOKEN: z.string().optional(),
    BUSINESS_PROFILE_PATH: z.string().default("profiles/construction-demo.json"),
    SML_MCP_BASE_URL: z.url().default("http://192.168.2.248:3515"),
    SML_MCP_ACCESS_MODE: z.string().min(1).default("sales"),
    SML_REQUEST_TIMEOUT_MS: numberFromEnv(1500),
    SML_DATASET_LABEL: z.string().default("construction-demo"),
    SML_TENANT_STATUS: z.enum(["demo", "real"]).default("demo"),
    SML_CIRCUIT_FAILURE_THRESHOLD: numberFromEnv(5),
    SML_CIRCUIT_OPEN_SECONDS: numberFromEnv(60),
    SML_MAX_CONCURRENT_CALLS: numberFromEnv(10),
    PRODUCT_SEARCH_CACHE_TTL_SECONDS: numberFromEnv(300),
    STOCK_CACHE_TTL_SECONDS: numberFromEnv(30),
    PRICE_CACHE_TTL_SECONDS: numberFromEnv(300),
    LOOKUP_TEST_ENDPOINT_ENABLED: booleanFromEnv,
    METRICS_ENABLED: z
      .string()
      .optional()
      .transform((value) => {
        if (value == null || value === "") return true;
        return ["1", "true", "yes", "on"].includes(value.toLowerCase());
      }),
    REDIS_URL: z.string().optional(),
    RATE_LIMIT_PER_MINUTE: numberFromEnv(20),
    ALERTS_ENABLED: booleanFromEnv,
    ALERT_TELEGRAM_BOT_TOKEN: z.string().optional(),
    OPS_TELEGRAM_CHAT_ID: z.string().optional(),
    ALERT_DEDUP_TTL_SECONDS: numberFromEnv(300),
    LINE_ENABLED: booleanFromEnv,
    LINE_CHANNEL_SECRET: z.string().optional(),
    LINE_CHANNEL_ACCESS_TOKEN: z.string().optional(),
    LINE_GROUP_PREFIXES: csvFromEnv(["/", "!"]),
    LLM_PARSER_ENABLED: booleanFromEnv,
    LLM_PARSER_MODE: z.enum(["off", "shadow", "assist"]).default("off"),
    LLM_PROVIDER: z.enum(["litellm", "openai"]).default("litellm"),
    LITELLM_BASE_URL: z.url().default("http://192.168.2.248:4000"),
    LITELLM_API_KEY: optionalStringFromEnv,
    LITELLM_MODEL: z.string().default("openrouter/openrouter/free"),
    OPENAI_API_KEY: optionalStringFromEnv,
    OPENAI_BASE_URL: optionalUrlFromEnv,
    LLM_PARSER_TIMEOUT_MS: numberFromEnv(7000),
    LLM_MIN_CONFIDENCE: numberFromEnv(0.75),
    TELEGRAM_CONTEXT_TTL_SECONDS: numberFromEnv(300),
    TELEGRAM_DEDUP_TTL_SECONDS: numberFromEnv(900),
    TELEGRAM_ENABLED: booleanFromEnv,
    TELEGRAM_POLLING_ENABLED: booleanFromEnv,
    TELEGRAM_WEBHOOK_ENABLED: booleanFromEnv,
    TELEGRAM_POLLING_INTERVAL_MS: numberFromEnv(1000),
    TELEGRAM_POLLING_TIMEOUT_SECONDS: numberFromEnv(25),
    TELEGRAM_BOT_TOKEN: z.string().optional(),
    TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
    TELEGRAM_BOT_USERNAME: z.string().optional(),
    CLOUDFLARE_TUNNEL_TOKEN: z.string().optional(),
    CLOUDFLARE_TUNNEL_HOSTNAME: z.string().optional()
  })
  .superRefine((env, ctx) => {
    const productionInternalEnabled = env.NODE_ENV === "production" && (env.LOOKUP_TEST_ENDPOINT_ENABLED || env.METRICS_ENABLED);
    if (productionInternalEnabled && !env.INTERNAL_API_TOKEN) {
      ctx.addIssue({
        code: "custom",
        path: ["INTERNAL_API_TOKEN"],
        message: "INTERNAL_API_TOKEN is required for production internal endpoints"
      });
    }
    if (env.LINE_ENABLED && (!env.LINE_CHANNEL_SECRET || !env.LINE_CHANNEL_ACCESS_TOKEN)) {
      ctx.addIssue({
        code: "custom",
        path: ["LINE_CHANNEL_SECRET"],
        message: "LINE_CHANNEL_SECRET and LINE_CHANNEL_ACCESS_TOKEN are required when LINE_ENABLED=true"
      });
    }
    const alertBotToken = env.ALERT_TELEGRAM_BOT_TOKEN ?? env.TELEGRAM_BOT_TOKEN;
    if (env.ALERTS_ENABLED && (!alertBotToken || !env.OPS_TELEGRAM_CHAT_ID)) {
      ctx.addIssue({
        code: "custom",
        path: ["OPS_TELEGRAM_CHAT_ID"],
        message:
          "OPS_TELEGRAM_CHAT_ID and ALERT_TELEGRAM_BOT_TOKEN or TELEGRAM_BOT_TOKEN are required when ALERTS_ENABLED=true"
      });
    }
    const telegramNeedsToken =
      env.TELEGRAM_ENABLED || env.TELEGRAM_POLLING_ENABLED || env.TELEGRAM_WEBHOOK_ENABLED;
    if (telegramNeedsToken && !env.TELEGRAM_BOT_TOKEN) {
      ctx.addIssue({
        code: "custom",
        path: ["TELEGRAM_BOT_TOKEN"],
        message: "TELEGRAM_BOT_TOKEN is required when Telegram is enabled"
      });
    }
    if (env.TELEGRAM_WEBHOOK_ENABLED && !env.TELEGRAM_WEBHOOK_SECRET) {
      ctx.addIssue({
        code: "custom",
        path: ["TELEGRAM_WEBHOOK_SECRET"],
        message: "TELEGRAM_WEBHOOK_SECRET is required when TELEGRAM_WEBHOOK_ENABLED=true"
      });
    }
    const llmEnabled = env.LLM_PARSER_ENABLED || env.LLM_PARSER_MODE !== "off";
    const llmApiKey = env.LITELLM_API_KEY ?? env.OPENAI_API_KEY;
    if (llmEnabled && !llmApiKey) {
      ctx.addIssue({
        code: "custom",
        path: ["LITELLM_API_KEY"],
        message: "LITELLM_API_KEY or OPENAI_API_KEY is required when LLM parser is enabled"
      });
    }
    if (env.LLM_MIN_CONFIDENCE < 0 || env.LLM_MIN_CONFIDENCE > 1) {
      ctx.addIssue({
        code: "custom",
        path: ["LLM_MIN_CONFIDENCE"],
        message: "LLM_MIN_CONFIDENCE must be between 0 and 1"
      });
    }
    if (env.LLM_PARSER_TIMEOUT_MS <= 0) {
      ctx.addIssue({
        code: "custom",
        path: ["LLM_PARSER_TIMEOUT_MS"],
        message: "LLM_PARSER_TIMEOUT_MS must be greater than 0"
      });
    }
  });

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${message}`);
  }
  return {
    ...parsed.data,
    LLM_PARSER_MODE:
      parsed.data.LLM_PARSER_ENABLED && parsed.data.LLM_PARSER_MODE === "off" ? "shadow" : parsed.data.LLM_PARSER_MODE
  };
}
