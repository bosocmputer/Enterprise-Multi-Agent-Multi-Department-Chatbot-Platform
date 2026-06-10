import { describe, expect, it } from "vitest";
import { loadBusinessProfile } from "../config/businessProfile.js";
import { MemoryCacheService } from "../services/cacheService.js";
import { resolveTextWithContext, saveLookupContext } from "./chatContext.js";

const profile = loadBusinessProfile("profiles/construction-demo.json");

describe("chat context helpers", () => {
  it("asks users to search again when numeric selection context expired", async () => {
    await expect(resolveTextWithContext({ businessProfile: profile, key: "k", text: "1" })).resolves.toMatchObject({
      kind: "reply",
      text: expect.stringContaining("หมดอายุ")
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
});
