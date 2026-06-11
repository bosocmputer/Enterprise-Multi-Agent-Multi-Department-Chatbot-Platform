import { describe, expect, it } from "vitest";
import { loadBusinessProfile } from "../config/businessProfile.js";
import { MemoryCacheService } from "../services/cacheService.js";
import { resolveTextWithContext, saveLookupContext } from "./chatContext.js";

const profile = loadBusinessProfile("profiles/construction-demo.json");

describe("chat context helpers", () => {
  it("asks users to search again when numeric selection context expired", async () => {
    await expect(resolveTextWithContext({ businessProfile: profile, key: "k", text: "1" })).resolves.toMatchObject({
      kind: "reply",
      text: expect.stringContaining("ยังไม่มีรายการล่าสุด")
    });
  });

  it("rejects out-of-range selection with the available range", async () => {
    const store = new MemoryCacheService();
    await saveLookupContext({
      contextStore: store,
      key: "k",
      result: {
        candidates: [
          { code: "A001", name: "สินค้า A" },
          { code: "A002", name: "สินค้า B" }
        ],
        intent: "price",
        keyword: "สินค้า",
        status: "multiple_matches"
      },
      ttlSeconds: 300
    });

    await expect(resolveTextWithContext({ businessProfile: profile, contextStore: store, key: "k", text: "3" })).resolves.toMatchObject({
      kind: "reply",
      text: expect.stringContaining("1-2")
    });
  });

  it("resolves intent-only follow-up against the last product", async () => {
    const store = new MemoryCacheService();
    await saveLookupContext({
      contextStore: store,
      key: "k",
      result: {
        cacheHit: false,
        datasetLabel: "test",
        intent: "stock_price",
        product: { code: "A001", name: "สินค้า A" },
        status: "success",
        tenantStatus: "demo"
      },
      ttlSeconds: 300
    });

    await expect(resolveTextWithContext({ businessProfile: profile, contextStore: store, key: "k", text: "ราคา" })).resolves.toEqual({
      kind: "lookup",
      text: "A001 ราคา"
    });
  });

  it("asks for a product when a product reference has no context", async () => {
    await expect(
      resolveTextWithContext({ businessProfile: profile, key: "k", text: "ตัวนี้ราคาเท่าไหร่" })
    ).resolves.toMatchObject({
      kind: "reply",
      text: expect.stringContaining("ยังไม่มีรายการล่าสุด")
    });
  });

  it("pages through multiple matches and selects from the latest page", async () => {
    const store = new MemoryCacheService();
    const candidates = Array.from({ length: 12 }, (_, index) => ({
      code: `A${String(index + 1).padStart(3, "0")}`,
      name: `สินค้า ${index + 1}`
    }));
    await saveLookupContext({
      contextStore: store,
      key: "k",
      result: {
        candidates,
        hasMore: true,
        intent: "price",
        keyword: "สินค้า",
        pageSize: 5,
        pageStart: 0,
        status: "multiple_matches",
        totalFound: 12
      },
      ttlSeconds: 300
    });

    await expect(
      resolveTextWithContext({
        businessProfile: profile,
        contextStore: store,
        contextTtlSeconds: 300,
        key: "k",
        text: "เพิ่ม"
      })
    ).resolves.toMatchObject({
      kind: "reply",
      text: expect.stringContaining("แสดง 6-10 จาก 12")
    });

    await expect(resolveTextWithContext({ businessProfile: profile, contextStore: store, key: "k", text: "1" })).resolves.toEqual({
      kind: "lookup",
      text: "A006 ราคา"
    });
  });

  it("asks users to search again when more-results context expired", async () => {
    await expect(resolveTextWithContext({ businessProfile: profile, key: "k", text: "เพิ่ม" })).resolves.toMatchObject({
      kind: "reply",
      text: expect.stringContaining("ยังไม่มีรายการล่าสุด")
    });
  });

  it("resolves product-reference follow-up against the last product", async () => {
    const store = new MemoryCacheService();
    await saveLookupContext({
      contextStore: store,
      key: "k",
      result: {
        cacheHit: false,
        datasetLabel: "test",
        intent: "stock_price",
        product: { code: "A001", name: "สินค้า A" },
        status: "success",
        tenantStatus: "demo"
      },
      ttlSeconds: 300
    });

    await expect(resolveTextWithContext({ businessProfile: profile, contextStore: store, key: "k", text: "ตัวนี้ราคาเท่าไหร่" })).resolves.toEqual({
      kind: "lookup",
      text: "A001 ราคา"
    });
  });

  it("does not search vague selection constraints without enough context", async () => {
    await expect(
      resolveTextWithContext({ businessProfile: profile, key: "k", text: "เอาแบบถูกสุดมีไหม" })
    ).resolves.toMatchObject({
      kind: "reply",
      text: expect.stringContaining("แบบถูกสุด")
    });
  });

  it("asks users to choose when selection constraints refer to recent candidates", async () => {
    const store = new MemoryCacheService();
    await saveLookupContext({
      contextStore: store,
      key: "k",
      result: {
        candidates: [
          { code: "C001", name: "ปูน A" },
          { code: "C002", name: "ปูน B" }
        ],
        intent: "stock",
        keyword: "ปูน",
        status: "multiple_matches"
      },
      ttlSeconds: 300
    });

    await expect(resolveTextWithContext({ businessProfile: profile, contextStore: store, key: "k", text: "เอาแบบถูกสุดมีไหม" })).resolves.toMatchObject({
      kind: "reply",
      text: expect.stringContaining("เลือกเลข 1-2")
    });
  });

  it("turns known bare profile keywords into search lookups instead of generic help", async () => {
    await expect(resolveTextWithContext({ businessProfile: profile, key: "k", text: "ปูนตราช้าง" })).resolves.toEqual({
      kind: "lookup",
      text: "ปูนตราช้าง หา"
    });
  });

  it("inherits the prior intent for a bare follow-up keyword", async () => {
    const store = new MemoryCacheService();
    await saveLookupContext({
      contextStore: store,
      key: "k",
      result: {
        candidates: [
          { code: "C001", name: "ปูน A" },
          { code: "C002", name: "ปูน B" }
        ],
        intent: "stock",
        keyword: "ปูน",
        status: "multiple_matches"
      },
      ttlSeconds: 300
    });

    await expect(resolveTextWithContext({ businessProfile: profile, contextStore: store, key: "k", text: "ปูนตราช้าง" })).resolves.toEqual({
      kind: "lookup",
      text: "ปูนตราช้าง มีไหม"
    });
  });

  it("does not append prior context intent when the new message has an explicit intent", async () => {
    const store = new MemoryCacheService();
    await saveLookupContext({
      contextStore: store,
      key: "k",
      result: {
        cacheHit: false,
        datasetLabel: "test",
        intent: "stock",
        product: { code: "PAINT-01424", name: "Beger น้ำมันสน" },
        status: "success",
        tenantStatus: "real"
      },
      ttlSeconds: 300
    });

    await expect(
      resolveTextWithContext({ businessProfile: profile, contextStore: store, key: "k", text: "PAINT-01424 ราคา" })
    ).resolves.toEqual({
      kind: "lookup",
      text: "PAINT-01424 ราคา"
    });
  });
});
