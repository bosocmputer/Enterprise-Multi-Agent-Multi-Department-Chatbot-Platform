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
});
