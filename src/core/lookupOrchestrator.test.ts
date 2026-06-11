import { describe, expect, it } from "vitest";
import { loadBusinessProfile } from "../config/businessProfile.js";
import { SmlClient } from "../integrations/smlClient.js";
import { MemoryCacheService } from "../services/cacheService.js";
import type { LookupLlmParser } from "./llmParser.js";
import { LookupOrchestrator } from "./lookupOrchestrator.js";

const profile = loadBusinessProfile("profiles/construction-demo.json");

describe("LookupOrchestrator", () => {
  it("asks user to choose when keyword returns multiple candidates", async () => {
    const lookup = new LookupOrchestrator(
      {
        searchProduct: async () => [
          { code: "A001", name: "น้ำมันสินค้า A" },
          { code: "A002", name: "น้ำมันสินค้า B" }
        ]
      } as unknown as SmlClient,
      new MemoryCacheService(),
      { businessProfile: profile, datasetLabel: "test" }
    );

    await expect(lookup.lookup({ text: "น้ำมัน ราคา" })).resolves.toMatchObject({
      status: "multiple_matches",
      keyword: "น้ำมัน"
    });
  });

  it("fetches stock and price concurrently for exact code", async () => {
    const lookup = new LookupOrchestrator(
      {
        searchProduct: async () => [{ code: "PAINT-01424", name: "Beger น้ำมันสน 100 เมตร (Premium)" }],
        getStockBalance: async () => [{ warehouse: "WH-01", qty: 10, unit: "ถัง" }],
        getProductPrice: async () => [{ unitName: "ถัง", price: 123 }]
      } as unknown as SmlClient,
      new MemoryCacheService(),
      { businessProfile: profile, datasetLabel: "test" }
    );

    await expect(lookup.lookup({ text: "PAINT-01424 มีไหม ราคาเท่าไร" })).resolves.toMatchObject({
      status: "success",
      product: { code: "PAINT-01424", name: "Beger น้ำมันสน 100 เมตร (Premium)" },
      stock: [{ warehouse: "WH-01", qty: 10 }],
      prices: [{ unitName: "ถัง", price: 123 }]
    });
  });

  it("uses product search to display exact-code name for price-only lookup", async () => {
    const lookup = new LookupOrchestrator(
      {
        searchProduct: async () => [{ code: "PAINT-01424", name: "Beger น้ำมันสน 100 เมตร (Premium)" }],
        getProductPrice: async () => [{ unitName: "ถัง", price: 123 }]
      } as unknown as SmlClient,
      new MemoryCacheService(),
      { businessProfile: profile, datasetLabel: "test" }
    );

    await expect(lookup.lookup({ text: "PAINT-01424 ราคา" })).resolves.toMatchObject({
      status: "success",
      product: { code: "PAINT-01424", name: "Beger น้ำมันสน 100 เมตร (Premium)" },
      prices: [{ unitName: "ถัง", price: 123 }]
    });
  });

  it("uses alias-expanded search terms from the business profile", async () => {
    const requestedTerms: string[] = [];
    const lookup = new LookupOrchestrator(
      {
        searchProduct: async (keyword: string) => {
          requestedTerms.push(keyword);
          if (keyword === "ปูนตราช้าง") return [{ code: "C000", name: "ปูนกาวทั่วไป" }];
          return keyword === "ปูน ช้าง" ? [{ code: "C001", name: "ปูน ช้าง" }] : [];
        },
        getStockBalance: async () => [{ warehouse: "WH-01", qty: 5, unit: "ถุง" }]
      } as unknown as SmlClient,
      new MemoryCacheService(),
      { businessProfile: profile, datasetLabel: "test" }
    );

    await expect(lookup.lookup({ text: "มีปูนตราช้างเหลือไหม" })).resolves.toMatchObject({
      status: "success",
      product: { code: "C001", name: "ปูน ช้าง" }
    });
    expect(requestedTerms).toEqual(expect.arrayContaining(["ปูนตราช้าง", "ปูน ช้าง"]));
  });

  it("does not guess from broad SML candidates when a specific search term does not match", async () => {
    const lookup = new LookupOrchestrator(
      {
        searchProduct: async () => [
          { code: "C000", name: "ปูนกาวทั่วไป" },
          { code: "C002", name: "Beger ปูนกาวปูกระเบื้อง" }
        ]
      } as unknown as SmlClient,
      new MemoryCacheService(),
      { businessProfile: profile, datasetLabel: "test" }
    );

    await expect(lookup.lookup({ text: "มีปูนตราช้างเหลือไหม" })).resolves.toMatchObject({
      status: "no_match",
      keyword: "ปูนตราช้าง"
    });
  });

  it("does not let shadow LLM output change the user-facing lookup result", async () => {
    let llmCalls = 0;
    const llmParser: LookupLlmParser = {
      metadata: { model: "openrouter/openrouter/free", provider: "litellm", timeoutMs: 6000 },
      parse: async () => {
        llmCalls += 1;
        return {
          aliases: ["ปูน ช้าง"],
          confidence: 0.99,
          intent: "stock",
          keyword: "ปูนตราช้าง",
          searchTerms: ["ปูนตราช้าง", "ปูน ช้าง"],
          status: "parsed"
        };
      }
    };
    const lookup = new LookupOrchestrator(
      {
        searchProduct: async () => []
      } as unknown as SmlClient,
      new MemoryCacheService(),
      { businessProfile: profile, datasetLabel: "test", llmParser, llmParserMode: "shadow" }
    );

    await expect(lookup.lookup({ text: "มีปูนตราช้างเหลือไหม" })).resolves.toMatchObject({
      status: "no_match",
      keyword: "ปูนตราช้าง"
    });
    expect(llmCalls).toBe(1);
  });

  it("does not call LLM assist for clear queries that return SML candidates", async () => {
    let llmCalls = 0;
    const llmParser: LookupLlmParser = {
      metadata: { model: "openrouter/openrouter/free", provider: "litellm", timeoutMs: 6000 },
      parse: async () => {
        llmCalls += 1;
        return { reason: "provider_error", status: "rejected" };
      }
    };
    const lookup = new LookupOrchestrator(
      {
        searchProduct: async () => [
          { code: "A001", name: "น้ำมันสินค้า A" },
          { code: "A002", name: "น้ำมันสินค้า B" }
        ]
      } as unknown as SmlClient,
      new MemoryCacheService(),
      { businessProfile: profile, datasetLabel: "test", llmParser, llmParserMode: "assist" }
    );

    await expect(lookup.lookup({ text: "น้ำมัน ราคา" })).resolves.toMatchObject({
      status: "multiple_matches",
      keyword: "น้ำมัน"
    });
    expect(llmCalls).toBe(0);
  });

  it("retries deterministic no-match once with LLM assist search terms", async () => {
    const requestedTerms: string[] = [];
    let llmCalls = 0;
    const llmParser: LookupLlmParser = {
      metadata: { model: "openrouter/openrouter/free", provider: "litellm", timeoutMs: 6000 },
      parse: async () => {
        llmCalls += 1;
        return {
          aliases: ["ปูนซีเมนต์ ตราช้าง"],
          confidence: 0.95,
          intent: "stock",
          keyword: "ปูนตราช้าง",
          searchTerms: ["ปูนซีเมนต์ ตราช้าง"],
          status: "parsed"
        };
      }
    };
    const lookup = new LookupOrchestrator(
      {
        searchProduct: async (keyword: string) => {
          requestedTerms.push(keyword);
          return keyword === "ปูนซีเมนต์ ตราช้าง" ? [{ code: "C100", name: "ปูนซีเมนต์ ตราช้าง" }] : [];
        },
        getStockBalance: async () => [{ warehouse: "WH-01", qty: 8, unit: "ถุง" }]
      } as unknown as SmlClient,
      new MemoryCacheService(),
      { businessProfile: profile, datasetLabel: "test", llmParser, llmParserMode: "assist" }
    );

    await expect(lookup.lookup({ text: "มีปูนตราช้างเหลือไหม" })).resolves.toMatchObject({
      status: "success",
      product: { code: "C100", name: "ปูนซีเมนต์ ตราช้าง" },
      stock: [{ warehouse: "WH-01", qty: 8 }]
    });
    expect(llmCalls).toBe(1);
    expect(requestedTerms).toEqual(expect.arrayContaining(["ปูนตราช้าง", "ปูน ช้าง", "ปูนซีเมนต์ ตราช้าง"]));
  });

  it("falls back to no-match when LLM assist is rejected", async () => {
    const llmParser: LookupLlmParser = {
      metadata: { model: "openrouter/openrouter/free", provider: "litellm", timeoutMs: 6000 },
      parse: async () => ({ reason: "low_confidence", status: "rejected" })
    };
    const lookup = new LookupOrchestrator(
      {
        searchProduct: async () => []
      } as unknown as SmlClient,
      new MemoryCacheService(),
      { businessProfile: profile, datasetLabel: "test", llmParser, llmParserMode: "assist" }
    );

    await expect(lookup.lookup({ text: "มีปูนตราช้างเหลือไหม" })).resolves.toMatchObject({
      assist: {
        model: "openrouter/openrouter/free",
        outcome: "rejected_low_confidence",
        reason: "no_match_retry",
        status: "rejected"
      },
      status: "no_match",
      keyword: "ปูนตราช้าง"
    });
  });
});
