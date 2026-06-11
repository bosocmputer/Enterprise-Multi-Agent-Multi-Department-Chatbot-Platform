import { describe, expect, it } from "vitest";
import { loadBusinessProfile } from "../config/businessProfile.js";
import type { LookupLlmParser } from "./llmParser.js";
import { understandLookupQuery } from "./queryUnderstanding.js";

const profile = loadBusinessProfile("profiles/construction-demo.json");

describe("understandLookupQuery", () => {
  it("does not call LLM when deterministic parser succeeds", async () => {
    let calls = 0;
    const parser: LookupLlmParser = {
      metadata: { model: "openrouter/openrouter/free", provider: "litellm", timeoutMs: 6000 },
      parse: async () => {
        calls += 1;
        return { reason: "provider_error", status: "rejected" };
      }
    };

    await expect(
      understandLookupQuery("มีปูนเหลือไหม", profile, {
        llmParser: parser,
        llmParserMode: "assist"
      })
    ).resolves.toMatchObject({
      status: "parsed",
      intent: "stock",
      keyword: "ปูน"
    });
    expect(calls).toBe(0);
  });

  it("uses LLM in assist mode only when deterministic parser is unsupported", async () => {
    let calls = 0;
    const parser: LookupLlmParser = {
      metadata: { model: "openrouter/openrouter/free", provider: "litellm", timeoutMs: 6000 },
      parse: async () => {
        calls += 1;
        return {
          confidence: 0.98,
          intent: "stock",
          keyword: "ปูนตราช้าง",
          searchTerms: ["ปูนตราช้าง", "ปูน ช้าง"],
          status: "parsed"
        };
      }
    };

    await expect(
      understandLookupQuery("ปูนตราช้าง", profile, {
        llmParser: parser,
        llmParserMode: "assist"
      })
    ).resolves.toMatchObject({
      status: "parsed",
      intent: "stock",
      keyword: "ปูนตราช้าง",
      searchTerms: ["ปูนตราช้าง", "ปูน ช้าง"]
    });
    expect(calls).toBe(1);
  });

  it("does not call LLM assist for friendly non-lookup text", async () => {
    let calls = 0;
    const parser: LookupLlmParser = {
      metadata: { model: "openrouter/openrouter/free", provider: "litellm", timeoutMs: 6000 },
      parse: async () => {
        calls += 1;
        return { reason: "provider_error", status: "rejected" };
      }
    };

    await expect(
      understandLookupQuery("สวัสดีครับ", profile, {
        llmParser: parser,
        llmParserMode: "assist"
      })
    ).resolves.toMatchObject({
      status: "unsupported",
      reason: "friendly_greeting"
    });
    expect(calls).toBe(0);
  });

  it("falls back to unsupported when LLM is rejected", async () => {
    const parser: LookupLlmParser = {
      metadata: { model: "openrouter/openrouter/free", provider: "litellm", timeoutMs: 6000 },
      parse: async () => ({ reason: "low_confidence", status: "rejected" })
    };

    await expect(
      understandLookupQuery("ปูนตราช้าง", profile, {
        llmParser: parser,
        llmParserMode: "assist"
      })
    ).resolves.toMatchObject({
      status: "unsupported",
      reason: "intent_not_found"
    });
  });

  it("emits assist start metadata when deterministic parsing is unsupported", async () => {
    const starts: unknown[] = [];
    const parser: LookupLlmParser = {
      metadata: { model: "openrouter/openrouter/free", provider: "litellm", timeoutMs: 6000 },
      parse: async () => ({ model: "openrouter/openrouter/free", reason: "timeout", status: "rejected" })
    };

    await expect(
      understandLookupQuery("ปูนตราช้าง", profile, {
        llmParser: parser,
        llmParserMode: "assist",
        onAssistStart: (event) => {
          starts.push(event);
        }
      })
    ).resolves.toMatchObject({
      assist: {
        model: "openrouter/openrouter/free",
        outcome: "rejected_timeout",
        reason: "unsupported",
        status: "rejected"
      },
      status: "unsupported"
    });
    expect(starts).toEqual([
      { model: "openrouter/openrouter/free", provider: "litellm", reason: "unsupported", timeoutMs: 6000 }
    ]);
  });
});
