import { describe, expect, it } from "vitest";
import { loadBusinessProfile, type BusinessProfile } from "../config/businessProfile.js";
import { resolveTextWithContext, saveLookupContext } from "../channels/chatContext.js";
import { SmlClient } from "../integrations/smlClient.js";
import { MemoryCacheService } from "../services/cacheService.js";
import { LookupOrchestrator } from "./lookupOrchestrator.js";
import { formatLookupReply } from "./responseFormatter.js";

const constructionProfile = loadBusinessProfile("profiles/construction-demo.json");
const autoPartsProfile = loadBusinessProfile("profiles/auto-parts-mock.json");

describe("domain-agnostic chat UX scenarios", () => {
  it.each([
    { profile: constructionProfile, expectedHint: "ส่งชื่อสินค้า", name: "construction" },
    { profile: autoPartsProfile, expectedHint: "ส่งชื่ออะไหล่", name: "auto-parts" }
  ])("handles help and greeting from profile copy for $name", async ({ expectedHint, profile }) => {
    await expect(resolveTextWithContext({ businessProfile: profile, key: "k", text: "สวัสดีครับ" })).resolves.toMatchObject({
      kind: "reply",
      text: expect.stringContaining(expectedHint)
    });

    const help = await resolveTextWithContext({ businessProfile: profile, key: "k", text: "ช่วยใช้งานยังไง" });
    expect(help).toMatchObject({
      kind: "reply",
      text: expect.stringContaining(expectedHint)
    });
    expect(help.text).toContain("วิธีคุยที่แนะนำ");
    expect(help.text).toContain("/help");
    expect(help.text).toContain("เพิ่ม - ดูรายการต่อไป");
    expect(help.text.split("\n").filter((line) => line.startsWith("- "))).toHaveLength(3);
    expect(help.text).not.toContain("ตอนนี้รองรับ");
  });

  it.each([
    {
      datasetLabel: "construction-test",
      entityType: "inventory_item",
      name: "construction exact id",
      priceUnit: "ถัง",
      profile: constructionProfile,
      resultName: "Beger น้ำมันสน",
      text: "PAINT-01424 ราคา"
    },
    {
      datasetLabel: "auto-parts-test",
      entityType: "part",
      name: "auto-parts exact id",
      priceUnit: "ชุด",
      profile: autoPartsProfile,
      resultName: "ผ้าเบรคหน้า Vios",
      text: "BRK-001 ราคา"
    }
  ])("uses the same exact-id lookup flow for $name", async ({ datasetLabel, entityType, priceUnit, profile, resultName, text }) => {
    const lookup = new LookupOrchestrator(
      {
        searchProduct: async () => [{ code: text.split(" ")[0] ?? "ID-001", name: resultName }],
        getProductPrice: async () => [{ price: 120, unitName: priceUnit }]
      } as unknown as SmlClient,
      new MemoryCacheService(),
      { businessProfile: profile as BusinessProfile, datasetLabel }
    );

    const result = await lookup.lookup({ text });
    expect(result).toMatchObject({
      entityType,
      product: { name: resultName },
      status: "success"
    });
    expect(formatLookupReply(result, profile)).toContain(resultName);
  });

  it("keeps follow-up context generic after a selected entry", async () => {
    const store = new MemoryCacheService();
    await saveLookupContext({
      contextStore: store,
      key: "k",
      result: {
        cacheHit: false,
        datasetLabel: "auto-parts-test",
        entityType: "part",
        intent: "stock_price",
        product: { code: "BRK-001", name: "ผ้าเบรคหน้า Vios" },
        status: "success",
        tenantStatus: "demo"
      },
      ttlSeconds: 300
    });

    await expect(
      resolveTextWithContext({ businessProfile: autoPartsProfile, contextStore: store, key: "k", text: "ตัวนี้ราคาเท่าไหร่" })
    ).resolves.toEqual({
      kind: "lookup",
      text: "BRK-001 ราคา"
    });
  });

  it("does not leak raw dependency or provider failures to user-facing replies", () => {
    const dependencyReply = formatLookupReply({ reason: "sml_timeout", status: "dependency_error" }, constructionProfile);
    const assistReply = formatLookupReply(
      {
        assist: {
          durationMs: 6000,
          model: "openrouter/openrouter/free",
          outcome: "rejected_provider_error",
          provider: "litellm",
          reason: "unsupported",
          status: "rejected",
          timeoutMs: 6000
        },
        reason: "intent_not_found",
        status: "unsupported"
      },
      constructionProfile
    );

    expect(dependencyReply).not.toContain("ระบบ SML");
    expect(assistReply).not.toContain("rejected_provider_error");
    expect(assistReply).not.toContain("provider_error");
  });
});
