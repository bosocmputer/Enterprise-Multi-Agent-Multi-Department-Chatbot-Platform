import pino from "pino";
import type { AppConfig } from "../config/env.js";

export function createLogger(config: Pick<AppConfig, "LOG_LEVEL">) {
  return pino({
    level: config.LOG_LEVEL,
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "req.headers.x-telegram-bot-api-secret-token",
        "*.token",
        "*.secret",
        "*.password",
        "*.ALERT_TELEGRAM_BOT_TOKEN",
        "*.TELEGRAM_BOT_TOKEN",
        "*.TELEGRAM_WEBHOOK_SECRET"
      ],
      censor: "[REDACTED]"
    }
  });
}
