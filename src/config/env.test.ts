import { describe, expect, it } from "vitest";
import { loadConfig } from "./env.js";

describe("loadConfig alert settings", () => {
  it("allows alerts to use a dedicated Telegram bot token", () => {
    const config = loadConfig({
      ALERTS_ENABLED: "true",
      ALERT_TELEGRAM_BOT_TOKEN: "alert-token",
      OPS_TELEGRAM_CHAT_ID: "12345"
    });

    expect(config.ALERTS_ENABLED).toBe(true);
    expect(config.ALERT_TELEGRAM_BOT_TOKEN).toBe("alert-token");
    expect(config.TELEGRAM_BOT_TOKEN).toBeUndefined();
  });

  it("fails fast when alerts are enabled without a bot token and chat id", () => {
    expect(() => loadConfig({ ALERTS_ENABLED: "true" })).toThrow(
      /OPS_TELEGRAM_CHAT_ID and ALERT_TELEGRAM_BOT_TOKEN or TELEGRAM_BOT_TOKEN/
    );
  });

  it("still requires the staff-facing Telegram token when Telegram channel is enabled", () => {
    expect(() =>
      loadConfig({
        TELEGRAM_ENABLED: "true",
        ALERT_TELEGRAM_BOT_TOKEN: "alert-token",
        OPS_TELEGRAM_CHAT_ID: "12345"
      })
    ).toThrow(/TELEGRAM_BOT_TOKEN is required when Telegram is enabled/);
  });

  it("derives shadow mode from the simple LLM parser enabled flag", () => {
    const config = loadConfig({
      LLM_PARSER_ENABLED: "true",
      LLM_PARSER_MODE: "off",
      LITELLM_API_KEY: "llm-key"
    });

    expect(config.LLM_PARSER_MODE).toBe("shadow");
  });

  it("keeps explicit assist mode when the simple LLM parser flag is enabled", () => {
    const config = loadConfig({
      LLM_PARSER_ENABLED: "true",
      LLM_PARSER_MODE: "assist",
      LITELLM_API_KEY: "llm-key"
    });

    expect(config.LLM_PARSER_MODE).toBe("assist");
  });

  it("fails fast when LLM parser is enabled without a key", () => {
    expect(() => loadConfig({ LLM_PARSER_MODE: "shadow" })).toThrow(/LITELLM_API_KEY or OPENAI_API_KEY/);
  });

  it("accepts OPENAI_API_KEY as an OpenAI-compatible LiteLLM key fallback", () => {
    const config = loadConfig({
      LLM_PARSER_MODE: "shadow",
      LLM_PROVIDER: "openai",
      OPENAI_API_KEY: "openai-compatible-key",
      OPENAI_BASE_URL: ""
    });

    expect(config.LLM_PROVIDER).toBe("openai");
    expect(config.OPENAI_API_KEY).toBe("openai-compatible-key");
    expect(config.OPENAI_BASE_URL).toBeUndefined();
  });

  it("defaults assist status UX to enabled with an 800ms delay", () => {
    const config = loadConfig({});

    expect(config.ASSIST_USER_STATUS_ENABLED).toBe(true);
    expect(config.ASSIST_USER_STATUS_SHOW_MODEL).toBe(true);
    expect(config.ASSIST_RESULT_FOOTER_ENABLED).toBe(true);
    expect(config.ASSIST_STATUS_MIN_DELAY_MS).toBe(800);
    expect(config.LLM_PARSER_TIMEOUT_MS).toBe(6000);
    expect(config.LLM_MAX_CONCURRENT_CALLS).toBe(2);
    expect(config.LLM_ASSIST_QUEUE_WAIT_MS).toBe(5000);
  });

  it("rejects negative assist status delay", () => {
    expect(() => loadConfig({ ASSIST_STATUS_MIN_DELAY_MS: "-1" })).toThrow(
      /ASSIST_STATUS_MIN_DELAY_MS must be greater than or equal to 0/
    );
  });

  it("rejects invalid LLM slow-path guard settings", () => {
    expect(() => loadConfig({ LLM_MAX_CONCURRENT_CALLS: "0" })).toThrow(
      /LLM_MAX_CONCURRENT_CALLS must be greater than 0/
    );
    expect(() => loadConfig({ LLM_ASSIST_QUEUE_WAIT_MS: "-1" })).toThrow(
      /LLM_ASSIST_QUEUE_WAIT_MS must be greater than or equal to 0/
    );
  });
});
