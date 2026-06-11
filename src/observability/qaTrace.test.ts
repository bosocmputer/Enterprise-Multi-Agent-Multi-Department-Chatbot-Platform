import type pino from "pino";
import { describe, expect, it } from "vitest";
import { logQaTrace, sanitizeTraceText, type QaTraceConfig } from "./qaTrace.js";

const baseConfig: QaTraceConfig = {
  enabled: true,
  includeBotReply: true,
  includeRawText: true,
  maxTextChars: 1000,
  redactSecrets: true,
  sampleRate: 1,
  ttlDays: 14
};

function captureLogger() {
  const entries: Array<{ message: string; payload: Record<string, unknown> }> = [];
  const logger = {
    info(payload: Record<string, unknown>, message: string) {
      entries.push({ message, payload });
    }
  } as unknown as pino.Logger;
  return { entries, logger };
}

describe("QA trace logging", () => {
  it("does nothing when disabled", () => {
    const { entries, logger } = captureLogger();

    logQaTrace(logger, { ...baseConfig, enabled: false }, {
      botReply: "reply",
      channel: "telegram",
      inputText: "PAINT-01424 ราคา",
      tenantId: "tenant-a"
    });

    expect(entries).toHaveLength(0);
  });

  it("keeps raw text and bot reply out unless explicitly enabled", () => {
    const { entries, logger } = captureLogger();

    logQaTrace(logger, { ...baseConfig, includeBotReply: false, includeRawText: false }, {
      botReply: "PAINT-01424 ราคา 123 บาท",
      channel: "telegram",
      inputText: "PAINT-01424 ราคา",
      tenantId: "tenant-a"
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.payload.rawText).toBeUndefined();
    expect(entries[0]?.payload.botReply).toBeUndefined();
    expect(entries[0]?.payload.inputTextHash).toBeDefined();
    expect(entries[0]?.payload.botReplyHash).toBeDefined();
  });

  it("redacts secrets from raw QA transcript fields", () => {
    const { entries, logger } = captureLogger();
    const fakeApiKey = ["sk", "testSecret123"].join("-");
    const fakeTelegramToken = ["1234567890", "FAKE_TEST_TOKEN_FOR_REDACTION_ONLY"].join(":");

    logQaTrace(logger, baseConfig, {
      botReply: "ใช้ Bearer abcdefghijklmnop",
      channel: "telegram",
      inputText: `bot ${fakeTelegramToken} key ${fakeApiKey}`,
      tenantId: "tenant-a"
    });

    expect(entries[0]?.payload.rawText).toContain("[REDACTED_TELEGRAM_TOKEN]");
    expect(entries[0]?.payload.rawText).toContain("[REDACTED_API_KEY]");
    expect(entries[0]?.payload.rawText).not.toContain("AAGVD2ZT");
    expect(entries[0]?.payload.botReply).toContain("Bearer [REDACTED_AUTH]");
  });

  it("logs structured decision trace without chain-of-thought", () => {
    const { entries, logger } = captureLogger();

    logQaTrace(logger, baseConfig, {
      botReply: "ไม่พบรายการ",
      channel: "telegram",
      inputText: "ปูนตราช้าง ราคา",
      result: {
        assist: {
          durationMs: 1800,
          model: "parts-lookup-parser-auto-2",
          outcome: "parsed",
          provider: "litellm",
          reason: "no_match_retry",
          status: "parsed",
          timeoutMs: 30000
        },
        conversationScope: "lookup_like",
        intent: "price",
        keyword: "ปูนตราช้าง",
        parserPath: "llm_assist",
        replyPolicy: "lookup",
        status: "no_match",
        tenantId: "tenant-a"
      },
      tenantId: "tenant-a"
    });

    expect(entries[0]?.payload.decisionTrace).toMatchObject({
      assist: { model: "parts-lookup-parser-auto-2", used: true },
      keywordHash: expect.any(String),
      parserPath: "llm_assist",
      status: "no_match"
    });
    expect(JSON.stringify(entries[0]?.payload)).not.toMatch(/chain|reasoning|thought/i);
  });

  it("truncates long trace text", () => {
    expect(sanitizeTraceText("abcdef", { maxTextChars: 3, redactSecrets: false })).toBe("abc...[truncated 3 chars]");
  });

  it("does not redact unlabeled barcodes or item numbers", () => {
    const text = sanitizeTraceText("8851234567890 ราคา เบอร์ 0812345678", {
      maxTextChars: 1000,
      redactSecrets: true
    });

    expect(text).toContain("8851234567890");
    expect(text).toContain("เบอร์=[REDACTED_NUMBER]");
  });
});
