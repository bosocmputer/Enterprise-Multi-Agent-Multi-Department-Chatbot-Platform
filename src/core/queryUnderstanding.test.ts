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

  it("blocks current-info questions before deterministic parser or LLM assist", async () => {
    let calls = 0;
    const parser: LookupLlmParser = {
      metadata: { model: "openrouter/openrouter/free", provider: "litellm", timeoutMs: 6000 },
      parse: async () => {
        calls += 1;
        return { reason: "provider_error", status: "rejected" };
      }
    };

    await expect(
      understandLookupQuery("ราคาทองวันนี้เท่าไหร่", profile, {
        llmParser: parser,
        llmParserMode: "assist"
      })
    ).resolves.toMatchObject({
      conversationScope: "out_of_scope_current_info",
      outOfScopeCategory: "current_info",
      parserPath: "none",
      reason: "out_of_scope_current_info",
      replyPolicy: "refuse_redirect",
      status: "unsupported"
    });
    expect(calls).toBe(0);
  });

  it("classifies requestable capability gaps before deterministic lookup parsing", async () => {
    let calls = 0;
    const parser: LookupLlmParser = {
      metadata: { model: "openrouter/openrouter/free", provider: "litellm", timeoutMs: 6000 },
      parse: async () => {
        calls += 1;
        return { reason: "provider_error", status: "rejected" };
      }
    };

    await expect(
      understandLookupQuery("PAINT-01424 ราคาทุนเท่าไหร่", profile, {
        llmParser: parser,
        llmParserMode: "assist"
      })
    ).resolves.toMatchObject({
      capabilityId: "purchase_cost",
      capabilityLabel: "ราคาทุน/ต้นทุน",
      parserPath: "deterministic",
      status: "capability_gap"
    });
    expect(calls).toBe(0);
  });

  it("allows lookup-like natural questions to use LLM assist", async () => {
    let calls = 0;
    const parser: LookupLlmParser = {
      metadata: { model: "openrouter/openrouter/free", provider: "litellm", timeoutMs: 6000 },
      parse: async () => {
        calls += 1;
        return {
          confidence: 0.9,
          intent: "price",
          keyword: "น้ำมันสน",
          searchTerms: ["น้ำมันสน"],
          status: "parsed"
        };
      }
    };

    await expect(
      understandLookupQuery("ช่วยดูน้ำมันสนให้หน่อย", profile, {
        llmParser: parser,
        llmParserMode: "assist"
      })
    ).resolves.toMatchObject({
      conversationScope: "lookup_like",
      intent: "price",
      keyword: "น้ำมันสน",
      parserPath: "llm_assist",
      replyPolicy: "lookup",
      status: "parsed"
    });
    expect(calls).toBe(1);
  });

  it("accepts LLM assist capability-gap classification only from the profile enum", async () => {
    const parser: LookupLlmParser = {
      metadata: { model: "parts-lookup-parser-auto-2", provider: "litellm", timeoutMs: 6000 },
      parse: async () => ({
        capabilityGap: {
          capabilityId: "supplier_lookup",
          capabilityLabel: "ข้อมูลผู้จำหน่าย/supplier",
          entityType: "inventory_item",
          requiredFields: ["รหัสสินค้า หรือคำค้นสินค้า"],
          source: "llm",
          suggestedReadOnlyTool: "get_product_supplier"
        },
        confidence: 0.95,
        intent: "unsupported",
        keyword: "ใครเป็นต้นทางของรายการนี้",
        query: "ใครเป็นต้นทางของรายการนี้",
        searchTerms: ["ต้นทางของรายการนี้"],
        status: "parsed"
      })
    };

    await expect(
      understandLookupQuery("ใครเป็นต้นทางของรายการนี้", profile, {
        llmParser: parser,
        llmParserMode: "assist"
      })
    ).resolves.toMatchObject({
      assist: { status: "parsed" },
      capabilityId: "supplier_lookup",
      parserPath: "llm_assist",
      status: "capability_gap"
    });
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
