import { describe, expect, it } from "vitest";
import { loadBusinessProfile } from "../config/businessProfile.js";
import { SmlClient } from "../integrations/smlClient.js";
import { MemoryCacheService } from "../services/cacheService.js";
import type { LookupLlmParser } from "./llmParser.js";
import { LookupOrchestrator } from "./lookupOrchestrator.js";

const profile = loadBusinessProfile("profiles/construction-demo.json");
const autoPartsProfile = loadBusinessProfile("profiles/auto-parts-mock.json");

class RecordingCacheService extends MemoryCacheService {
  readonly setKeys: string[] = [];

  override async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    this.setKeys.push(key);
    await super.set(key, value, ttlSeconds);
  }
}

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
      action: "price",
      entityType: "inventory_item",
      source: "sml",
      status: "multiple_matches",
      tenantId: "construction-demo",
      keyword: "น้ำมัน"
    });
  });

  it("maps SML inventory candidates into generic entity metadata", async () => {
    const lookup = new LookupOrchestrator(
      {
        searchProduct: async () => [{ code: "A001", name: "รายการ A", unit: "ชิ้น" }]
      } as unknown as SmlClient,
      new MemoryCacheService(),
      { businessProfile: profile, datasetLabel: "test" }
    );

    await expect(lookup.lookup({ text: "รายการ หา" })).resolves.toMatchObject({
      action: "search",
      candidates: [
        {
          code: "A001",
          entity: {
            id: "A001",
            label: "รายการ A",
            metadata: { unit: "ชิ้น" },
            type: "inventory_item"
          }
        }
      ],
      entities: [
        {
          id: "A001",
          label: "รายการ A",
          type: "inventory_item"
        }
      ],
      entityType: "inventory_item",
      status: "multiple_matches"
    });
  });

  it("uses the same lookup core with a mock auto-parts domain profile", async () => {
    const lookup = new LookupOrchestrator(
      {
        searchProduct: async () => [{ code: "BRK-001", name: "ผ้าเบรคหน้า Vios", unit: "ชุด" }],
        getStockBalance: async () => [{ warehouse: "MAIN", qty: 4, unit: "ชุด" }]
      } as unknown as SmlClient,
      new MemoryCacheService(),
      { businessProfile: autoPartsProfile, datasetLabel: "mock-auto-parts" }
    );

    await expect(lookup.lookup({ text: "ผ้าเบรคหน้า vios มีไหม" })).resolves.toMatchObject({
      action: "availability",
      entity: {
        id: "BRK-001",
        label: "ผ้าเบรคหน้า Vios",
        type: "part"
      },
      entityType: "part",
      product: { code: "BRK-001" },
      source: "mock-catalog",
      status: "success",
      stock: [{ qty: 4, warehouse: "MAIN" }],
      tenantId: "auto-parts-mock"
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
    const cache = new RecordingCacheService();
    const lookup = new LookupOrchestrator(
      {
        searchProduct: async () => [{ code: "PAINT-01424", name: "Beger น้ำมันสน 100 เมตร (Premium)" }],
        getProductPrice: async () => [{ unitName: "ถัง", price: 123 }]
      } as unknown as SmlClient,
      cache,
      { businessProfile: profile, datasetLabel: "test" }
    );

    await expect(lookup.lookup({ text: "PAINT-01424 ราคา" })).resolves.toMatchObject({
      action: "price",
      entity: { id: "PAINT-01424", type: "inventory_item" },
      entityType: "inventory_item",
      status: "success",
      tenantId: "construction-demo",
      product: { code: "PAINT-01424", name: "Beger น้ำมันสน 100 เมตร (Premium)" },
      prices: [{ unitName: "ถัง", price: 123 }]
    });
    expect(cache.setKeys).toEqual(
      expect.arrayContaining([
        expect.stringContaining("lookup:construction-demo:entity:inventory_item:search:v3:paint-01424"),
        expect.stringContaining("lookup:construction-demo:entity:inventory_item:action:price:price:PAINT-01424")
      ])
    );
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

  it("does not call SML or LLM for out-of-scope current information", async () => {
    let smlCalls = 0;
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
        searchProduct: async () => {
          smlCalls += 1;
          return [];
        }
      } as unknown as SmlClient,
      new MemoryCacheService(),
      { businessProfile: profile, datasetLabel: "test", llmParser, llmParserMode: "assist" }
    );

    await expect(lookup.lookup({ text: "ราคาทองวันนี้เท่าไหร่" })).resolves.toMatchObject({
      conversationScope: "out_of_scope_current_info",
      outOfScopeCategory: "current_info",
      parserPath: "none",
      replyPolicy: "refuse_redirect",
      status: "unsupported"
    });
    expect(smlCalls).toBe(0);
    expect(llmCalls).toBe(0);
  });

  it("returns capability gap without calling SML or LLM when a requestable capability matches the profile", async () => {
    let smlCalls = 0;
    let llmCalls = 0;
    const llmParser: LookupLlmParser = {
      metadata: { model: "parts-lookup-parser-auto-2", provider: "litellm", timeoutMs: 6000 },
      parse: async () => {
        llmCalls += 1;
        return { reason: "provider_error", status: "rejected" };
      }
    };
    const lookup = new LookupOrchestrator(
      {
        searchProduct: async () => {
          smlCalls += 1;
          return [];
        },
        getProductPrice: async () => {
          smlCalls += 1;
          return [];
        }
      } as unknown as SmlClient,
      new MemoryCacheService(),
      { businessProfile: profile, datasetLabel: "test", llmParser, llmParserMode: "assist" }
    );

    await expect(lookup.lookup({ text: "PAINT-01424 ราคาทุนเท่าไหร่" })).resolves.toMatchObject({
      capabilityId: "purchase_cost",
      entityType: "inventory_item",
      parserPath: "deterministic",
      source: "none",
      status: "capability_gap",
      tenantId: "construction-demo"
    });
    expect(smlCalls).toBe(0);
    expect(llmCalls).toBe(0);
  });

  it("answers lookup coaching without calling SML or LLM", async () => {
    let smlCalls = 0;
    let llmCalls = 0;
    const llmParser: LookupLlmParser = {
      metadata: { model: "parts-lookup-parser-auto-2", provider: "litellm", timeoutMs: 6000 },
      parse: async () => {
        llmCalls += 1;
        return { reason: "provider_error", status: "rejected" };
      }
    };
    const lookup = new LookupOrchestrator(
      {
        searchProduct: async () => {
          smlCalls += 1;
          return [];
        }
      } as unknown as SmlClient,
      new MemoryCacheService(),
      { businessProfile: profile, datasetLabel: "test", llmParser, llmParserMode: "assist" }
    );

    await expect(
      lookup.lookup({ text: "ถ้าหา PAINT-01424 ไม่เจอ ช่วยแนะนำว่าควรค้นด้วยคำไหนต่อ" })
    ).resolves.toMatchObject({
      conversationScope: "coaching",
      parserPath: "none",
      replyPolicy: "coaching",
      status: "unsupported"
    });
    expect(smlCalls).toBe(0);
    expect(llmCalls).toBe(0);
  });

  it("answers recommendation guidance without calling SML or LLM", async () => {
    let smlCalls = 0;
    let llmCalls = 0;
    const llmParser: LookupLlmParser = {
      metadata: { model: "parts-lookup-parser-auto-2", provider: "litellm", timeoutMs: 6000 },
      parse: async () => {
        llmCalls += 1;
        return { reason: "provider_error", status: "rejected" };
      }
    };
    const lookup = new LookupOrchestrator(
      {
        searchProduct: async () => {
          smlCalls += 1;
          return [];
        }
      } as unknown as SmlClient,
      new MemoryCacheService(),
      { businessProfile: profile, datasetLabel: "test", llmParser, llmParserMode: "assist" }
    );

    await expect(lookup.lookup({ text: "มีตัวไหนใกล้เคียงกับปูนตราช้างแต่ราคาถูกกว่าบ้าง" })).resolves.toMatchObject({
      conversationScope: "coaching",
      parserPath: "none",
      replyPolicy: "coaching",
      status: "unsupported"
    });
    expect(smlCalls).toBe(0);
    expect(llmCalls).toBe(0);
  });

  it("asks for refinement when LLM assist search terms return broad weak matches", async () => {
    const llmParser: LookupLlmParser = {
      metadata: { model: "parts-lookup-parser-auto-2", provider: "litellm", timeoutMs: 6000 },
      parse: async () => ({
        confidence: 0.96,
        intent: "price",
        keyword: "Beger น้ำมันสน High-Gloss",
        searchTerms: ["Beger High-Gloss"],
        status: "parsed"
      })
    };
    const lookup = new LookupOrchestrator(
      {
        searchProduct: async () => [
          { code: "A001", name: "Beger ปูนกาว High-Gloss" },
          { code: "A002", name: "Beger เหล็ก High-Gloss" }
        ]
      } as unknown as SmlClient,
      new MemoryCacheService(),
      { businessProfile: profile, datasetLabel: "test", llmParser, llmParserMode: "assist" }
    );

    await expect(lookup.lookup({ text: "หา Beger น้ำมันสนที่เป็น High-Gloss แล้วดูราคาด้วย" })).resolves.toMatchObject({
      assist: { status: "parsed" },
      resultQuality: "needs_refinement",
      status: "needs_refinement"
    });
  });

  it("keeps strong result-quality matches after LLM assist", async () => {
    const llmParser: LookupLlmParser = {
      metadata: { model: "parts-lookup-parser-auto-2", provider: "litellm", timeoutMs: 6000 },
      parse: async () => ({
        confidence: 0.96,
        intent: "price",
        keyword: "Beger น้ำมันสน High-Gloss",
        searchTerms: ["Beger High-Gloss"],
        status: "parsed"
      })
    };
    const lookup = new LookupOrchestrator(
      {
        searchProduct: async () => [
          { code: "A001", name: "Beger น้ำมันสน High-Gloss" },
          { code: "A002", name: "Beger ปูนกาว High-Gloss" }
        ],
        getProductPrice: async () => [{ price: 199, unitName: "ชิ้น" }]
      } as unknown as SmlClient,
      new MemoryCacheService(),
      { businessProfile: profile, datasetLabel: "test", llmParser, llmParserMode: "assist" }
    );

    await expect(lookup.lookup({ text: "หา Beger น้ำมันสนที่เป็น High-Gloss แล้วดูราคาด้วย" })).resolves.toMatchObject({
      product: { code: "A001" },
      status: "success"
    });
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
