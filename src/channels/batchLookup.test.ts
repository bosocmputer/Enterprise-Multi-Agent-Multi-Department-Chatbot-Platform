import { describe, expect, it } from "vitest";
import { loadBusinessProfile } from "../config/businessProfile.js";
import type { LookupOrchestrator } from "../core/lookupOrchestrator.js";
import { planBatchLookup, prefixBatchReply, runBatchLookupItems } from "./batchLookup.js";

const profile = loadBusinessProfile("profiles/construction-demo.json");

describe("batch lookup planning", () => {
  it("splits bounded lookup batches", () => {
    expect(
      planBatchLookup("PAINT-01424 ราคา\nน้ำมัน ราคา\nถ้าหา PAINT-01424 ไม่เจอ ควรค้นด้วยคำไหนต่อ", profile, {
        enabled: true,
        maxItems: 5,
        maxTextChars: 1200
      })
    ).toEqual({
      kind: "batch",
      items: [
        "PAINT-01424 ราคา",
        "น้ำมัน ราคา",
        "ถ้าหา PAINT-01424 ไม่เจอ ควรค้นด้วยคำไหนต่อ"
      ]
    });
  });

  it("rejects batches over item and text limits", () => {
    expect(
      planBatchLookup("a ราคา\nb ราคา\nc ราคา", profile, {
        enabled: true,
        maxItems: 2,
        maxTextChars: 1200
      })
    ).toMatchObject({ kind: "reply", outcome: "too_many" });

    expect(
      planBatchLookup("PAINT-01424 ราคา\nน้ำมัน ราคา", profile, {
        enabled: true,
        maxItems: 5,
        maxTextChars: 10
      })
    ).toMatchObject({ kind: "reply", outcome: "too_long" });
  });

  it("rejects mixed non-lookup batches", () => {
    expect(
      planBatchLookup("PAINT-01424 ราคา\nอากาศวันนี้เป็นยังไง", profile, {
        enabled: true,
        maxItems: 5,
        maxTextChars: 1200
      })
    ).toMatchObject({ kind: "reply", outcome: "mixed" });
  });

  it("accepts requestable capability-gap items inside bounded batches", () => {
    expect(
      planBatchLookup("PAINT-01424 ราคาทุน\nPAINT-01424 supplier", profile, {
        enabled: true,
        maxItems: 5,
        maxTextChars: 1200
      })
    ).toEqual({
      kind: "batch",
      items: ["PAINT-01424 ราคาทุน", "PAINT-01424 supplier"]
    });
  });

  it("answers all-coaching batches as one profile-driven guidance message", async () => {
    let lookupCalls = 0;
    const lookup = {
      lookup: async () => {
        lookupCalls += 1;
        return { reason: "should_not_lookup", status: "unsupported" };
      }
    } as unknown as LookupOrchestrator;
    const items = [
      "ถ้าลูกค้าอยากได้ของถูกสุดในกลุ่มน้ำมันสน ควรถามต่อยังไง",
      "มีตัวไหนใกล้เคียงกับปูนตราช้างแต่ราคาถูกกว่าบ้าง",
      "ถ้าหา PAINT-01424 ไม่เจอ ช่วยแนะนำว่าควรค้นด้วยคำไหนต่อ",
      "ลูกค้าถามว่าน้ำมันสนแบบดี ๆ มีไหม ช่วยตีความคำค้นที่ควรใช้"
    ];

    const result = await runBatchLookupItems({
      businessProfile: profile,
      channel: "telegram",
      items,
      lookup
    });

    expect(lookupCalls).toBe(0);
    expect(result.outcomes).toEqual(["coaching_batch"]);
    expect(result.replies).toHaveLength(1);
    expect(result.replies[0]).not.toContain("ต้องใช้รายการล่าสุด");
    expect(result.replies[0]).toContain("น้ำมันสน ราคา");
    expect(result.replies[0]).toContain("ปูนตราช้าง ราคา");
    expect(result.replies[0]).toContain("PAINT-01424 ราคา");
    expect(result.replies[0]).toContain("น้ำมันสนแบบดี ๆ มีของไหม ราคา");
    expect(prefixBatchReply(0, result.replies.length, result.replies[0] ?? "")).not.toContain("[1/1]");
  });

  it("keeps true context-only commands blocked inside mixed batches", async () => {
    let lookupCalls = 0;
    const lookup = {
      lookup: async () => {
        lookupCalls += 1;
        return {
          cacheHit: false,
          datasetLabel: "test",
          intent: "price",
          product: { code: "PAINT-01424", name: "Test item" },
          status: "success",
          tenantStatus: "real"
        };
      }
    } as unknown as LookupOrchestrator;

    const result = await runBatchLookupItems({
      businessProfile: profile,
      channel: "telegram",
      items: ["PAINT-01424 ราคา", "เพิ่ม", "ถ้าหา PAINT-01424 ไม่เจอ ควรค้นด้วยคำไหนต่อ"],
      lookup
    });

    expect(lookupCalls).toBe(1);
    expect(result.outcomes).toEqual(["success", "context_only_blocked", "lookup_coaching"]);
    expect(result.replies[1]).toBe(profile.replyStyle.batchContextOnlyMessage);
    expect(result.replies[2]).toBe(profile.replyStyle.lookupCoachingMessage);
  });
});
