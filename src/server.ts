import { loadConfig } from "./config/env.js";
import { createApp } from "./app.js";
import { TelegramAdapter } from "./channels/telegramAdapter.js";
import { TelegramPollingWorker } from "./channels/telegramPollingWorker.js";
import { createLogger } from "./observability/logger.js";
import { createRuntime } from "./runtime.js";

const config = loadConfig();
const runtime = createRuntime(config);
const app = createApp(config, runtime);
const logger = createLogger(config);

const pollingWorker = config.TELEGRAM_POLLING_ENABLED
  ? new TelegramPollingWorker(
      new TelegramAdapter({
        botToken: config.TELEGRAM_BOT_TOKEN as string,
        alerts: runtime.alerts,
        assistResultFooterEnabled: config.ASSIST_RESULT_FOOTER_ENABLED,
        assistStatusMinDelayMs: config.ASSIST_STATUS_MIN_DELAY_MS,
        assistUserStatusEnabled: config.ASSIST_USER_STATUS_ENABLED,
        assistUserStatusShowModel: config.ASSIST_USER_STATUS_SHOW_MODEL,
        businessProfile: runtime.businessProfile,
        botUsername: config.TELEGRAM_BOT_USERNAME,
        contextStore: runtime.state,
        contextTtlSeconds: config.TELEGRAM_CONTEXT_TTL_SECONDS,
        dedupStore: runtime.state,
        dedupTtlSeconds: config.TELEGRAM_DEDUP_TTL_SECONDS,
        logger,
        llmParser: runtime.llmParser,
        llmParserMode: config.LLM_PARSER_MODE,
        metrics: runtime.metrics,
        rateLimiter: runtime.state,
        rateLimitPerMinute: config.RATE_LIMIT_PER_MINUTE
      }),
      runtime.lookup,
      {
        intervalMs: config.TELEGRAM_POLLING_INTERVAL_MS,
        timeoutSeconds: config.TELEGRAM_POLLING_TIMEOUT_SECONDS,
        logger
      }
    )
  : undefined;

const shutdown = async () => {
  await pollingWorker?.stop();
  await app.close();
  await runtime.close();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

await app.listen({ port: config.PORT, host: "0.0.0.0" });
pollingWorker?.start();
