import { describe, expect, it } from "vitest";
import { loadBusinessProfile } from "../config/businessProfile.js";
import { formatLookupReply } from "./responseFormatter.js";

const profile = loadBusinessProfile("profiles/construction-demo.json");

describe("response formatter", () => {
  it("formats multi-match pages with stable 1-5 selection numbers", () => {
    const candidates = Array.from({ length: 12 }, (_, index) => ({
      code: `A${String(index + 1).padStart(3, "0")}`,
      name: `สินค้า ${index + 1}`
    }));

    const reply = formatLookupReply(
      {
        candidates,
        hasMore: true,
        intent: "price",
        keyword: "สินค้า",
        pageSize: 5,
        pageStart: 5,
        status: "multiple_matches",
        totalFound: 12
      },
      profile
    );

    expect(reply).toContain("แสดง 6-10 จาก 12");
    expect(reply).toContain("1. A006 - สินค้า 6");
    expect(reply).toContain("5. A010 - สินค้า 10");
    expect(reply).toContain("เพิ่ม");
  });

  it("appends assist footer only when assist parsed successfully", () => {
    const reply = formatLookupReply(
      {
        cacheHit: false,
        datasetLabel: "sml-test",
        intent: "stock",
        product: { code: "C001", name: "ปูน" },
        status: "success",
        stock: [{ qty: 1, warehouse: "WH-01" }],
        tenantStatus: "real",
        assist: {
          durationMs: 3200,
          model: "openrouter/openrouter/free",
          outcome: "parsed",
          provider: "litellm",
          reason: "no_match_retry",
          status: "parsed",
          timeoutMs: 6000
        }
      },
      profile
    );

    expect(reply).toContain("Assist: LiteLLM openrouter/openrouter/free");
    expect(reply).toContain("ข้อมูลสินค้า/ราคา/สต็อกมาจากระบบต้นทาง");
  });

  it("uses friendly assist failure copy when assist is rejected", () => {
    const reply = formatLookupReply(
      {
        intent: "stock",
        keyword: "ปูนตราช้าง",
        status: "no_match",
        assist: {
          durationMs: 6001,
          model: "openrouter/openrouter/free",
          outcome: "rejected_timeout",
          provider: "litellm",
          reason: "no_match_retry",
          status: "rejected",
          timeoutMs: 6000
        }
      },
      profile
    );

    expect(reply).toContain("ยังตีความคำถามนี้ไม่สำเร็จ");
    expect(reply).not.toContain("rejected_timeout");
    expect(reply).not.toContain("6001ms");
    expect(reply).not.toContain("provider_error");
  });

  it("formats friendly unsupported replies without showing the full help every time", () => {
    const reply = formatLookupReply(
      {
        reason: "friendly_greeting",
        status: "unsupported"
      },
      profile
    );

    expect(reply).toContain("ส่งชื่อสินค้า");
    expect(reply.split("\n").filter((line) => line.startsWith("- "))).toHaveLength(0);
  });

  it("formats recommendation guidance with profile copy", () => {
    const reply = formatLookupReply(
      {
        conversationScope: "coaching",
        parserPath: "none",
        reason: "friendly_recommendation_guidance",
        replyPolicy: "coaching",
        status: "unsupported"
      },
      profile
    );

    expect(reply).toBe(profile.replyStyle.recommendationGuidanceMessage);
  });

  it("formats out-of-scope current info as a polite redirect", () => {
    const reply = formatLookupReply(
      {
        conversationScope: "out_of_scope_current_info",
        outOfScopeCategory: "current_info",
        parserPath: "none",
        reason: "out_of_scope_current_info",
        replyPolicy: "refuse_redirect",
        status: "unsupported"
      },
      profile
    );

    expect(reply).toContain("ข้อมูลภายนอกยังไม่รองรับ");
    expect(reply).toContain("ส่งชื่อสินค้า");
  });

  it("formats out-of-scope general chat as a polite redirect", () => {
    const reply = formatLookupReply(
      {
        conversationScope: "out_of_scope_general",
        outOfScopeCategory: "general",
        parserPath: "none",
        reason: "out_of_scope_general",
        replyPolicy: "refuse_redirect",
        status: "unsupported"
      },
      profile
    );

    expect(reply).toContain("คำถามทั่วไป");
    expect(reply).toContain("ส่งชื่อสินค้า");
  });

  it("uses generic source-system wording for dependency failures", () => {
    const reply = formatLookupReply(
      {
        reason: "sml_timeout",
        status: "dependency_error"
      },
      profile
    );

    expect(reply).toContain("ระบบต้นทาง");
    expect(reply).not.toContain("ระบบ SML");
  });

  it("formats capability gaps without technical MCP hints by default", () => {
    const reply = formatLookupReply(
      {
        capabilityId: "purchase_cost",
        capabilityLabel: "ราคาทุน/ต้นทุน",
        entityType: "inventory_item",
        source: "none",
        status: "capability_gap",
        suggestedReadOnlyTool: "get_product_cost",
        tenantId: "construction-demo"
      },
      profile
    );

    expect(reply).toContain("เพิ่ม read-only MCP สำหรับ ราคาทุน/ต้นทุน");
    expect(reply).not.toContain("get_product_cost");
  });

  it("formats capability gaps with technical MCP hints when enabled", () => {
    const reply = formatLookupReply(
      {
        capabilityId: "purchase_cost",
        capabilityLabel: "ราคาทุน/ต้นทุน",
        entityType: "inventory_item",
        source: "none",
        status: "capability_gap",
        suggestedReadOnlyTool: "get_product_cost",
        tenantId: "construction-demo"
      },
      profile,
      { capabilityGapShowTechnicalHint: true }
    );

    expect(reply).toContain("เพิ่ม read-only MCP สำหรับ ราคาทุน/ต้นทุน");
    expect(reply).toContain("MCP ที่แนะนำ: get_product_cost");
  });

  it("asks users to refine when source has more results than the local candidate buffer", () => {
    const candidates = Array.from({ length: 20 }, (_, index) => ({
      code: `A${String(index + 1).padStart(3, "0")}`,
      name: `สินค้า ${index + 1}`
    }));

    const reply = formatLookupReply(
      {
        candidates,
        hasMore: true,
        intent: "price",
        keyword: "สินค้า",
        pageSize: 5,
        pageStart: 15,
        status: "multiple_matches",
        totalFound: 58
      },
      profile
    );

    expect(reply).toContain("แสดง 16-20 จาก 58");
    expect(reply).toContain("ยังมีรายการมากกว่านี้");
    expect(reply).not.toContain("พิมพ์ \"เพิ่ม\"");
  });
});
