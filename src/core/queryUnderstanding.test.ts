import { describe, expect, it } from "vitest";
import { loadBusinessProfile } from "../config/businessProfile.js";
import type { LookupLlmParser } from "./llmParser.js";
import { understandLookupQuery } from "./queryUnderstanding.js";

const profile = loadBusinessProfile("profiles/construction-demo.json");

describe("understandLookupQuery", () => {
  it("does not call LLM when deterministic parser succeeds", async () => {
    let calls = 0;
    const parser: LookupLlmParser = {
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
    const parser: LookupLlmParser = {
      parse: async () => ({
        aliases: ["ปูน ช้าง"],
        confidence: 0.98,
        intent: "stock",
        keyword: "ปูนตราช้าง",
        searchTerms: ["ปูนตราช้าง", "ปูน ช้าง"],
        status: "parsed"
      })
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
  });

  it("falls back to unsupported when LLM is rejected", async () => {
    const parser: LookupLlmParser = {
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
});
