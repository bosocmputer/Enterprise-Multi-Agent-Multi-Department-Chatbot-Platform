import { describe, expect, it } from "vitest";
import { businessProfileSchema, loadBusinessProfile } from "../config/businessProfile.js";
import { parseLookupQuery } from "./queryParser.js";

const profile = loadBusinessProfile("profiles/construction-demo.json");

describe("parseLookupQuery", () => {
  it("parses clear stock and price question", () => {
    expect(parseLookupQuery("น้ำมัน มีไหม ราคาเท่าไร", profile)).toMatchObject({
      action: "availability_price",
      entityType: "inventory_item",
      status: "parsed",
      intent: "stock_price",
      keyword: "น้ำมัน",
      isExactCode: false,
      searchTerms: ["น้ำมัน"]
    });
  });

  it("parses exact code command", () => {
    expect(parseLookupQuery("/stock PAINT-01424", profile)).toMatchObject({
      action: "availability",
      entityType: "inventory_item",
      status: "parsed",
      intent: "stock",
      keyword: "PAINT-01424",
      isExactCode: true,
      searchTerms: ["PAINT-01424"]
    });
  });

  it("parses embedded Thai stock questions", () => {
    expect(parseLookupQuery("มีปูนเหลือไหม", profile)).toMatchObject({
      action: "availability",
      entityType: "inventory_item",
      status: "parsed",
      intent: "stock",
      keyword: "ปูน",
      isExactCode: false,
      searchTerms: ["ปูน"]
    });
    expect(parseLookupQuery("มีปูนไหม", profile)).toMatchObject({
      action: "availability",
      entityType: "inventory_item",
      status: "parsed",
      intent: "stock",
      keyword: "ปูน",
      isExactCode: false,
      searchTerms: ["ปูน"]
    });
  });

  it("keeps product names that start with the Thai existential prefix", () => {
    expect(parseLookupQuery("มีด มีไหม", profile)).toMatchObject({
      action: "availability",
      entityType: "inventory_item",
      status: "parsed",
      intent: "stock",
      keyword: "มีด",
      isExactCode: false,
      searchTerms: ["มีด"]
    });
  });

  it("expands aliases from the business profile without choosing a product", () => {
    const result = parseLookupQuery("มีปูนตราช้างเหลือไหม", profile);
    expect(result).toMatchObject({
      status: "parsed",
      intent: "stock",
      keyword: "ปูนตราช้าง"
    });
    expect(result.status === "parsed" ? result.searchTerms : []).toEqual(
      expect.arrayContaining(["ปูนตราช้าง", "ปูน ช้าง"])
    );
  });

  it("parses known bare keywords when context adds a search intent", () => {
    const result = parseLookupQuery("ปูนตราช้าง หา", profile);
    expect(result).toMatchObject({
      status: "parsed",
      intent: "search_product",
      keyword: "ปูนตราช้าง"
    });
    expect(result.status === "parsed" ? result.searchTerms : []).toEqual(
      expect.arrayContaining(["ปูนตราช้าง", "ปูน ช้าง"])
    );
  });

  it("rejects unsupported chatter", () => {
    expect(parseLookupQuery("สวัสดีครับ", profile)).toEqual({
      status: "unsupported",
      reason: "intent_not_found"
    });
  });

  it("reads slash command aliases from the domain profile", () => {
    const genericProfile = businessProfileSchema.parse({
      businessType: "generic",
      domain: {
        version: 2,
        defaultEntityType: "catalog_entry",
        entities: [{ type: "catalog_entry", label: "entry" }],
        actions: [
          {
            id: "availability",
            legacyIntent: "stock",
            entityTypes: ["catalog_entry"],
            phrases: ["available"],
            commandAliases: ["avail"]
          }
        ],
        connectors: [
          {
            actionToolMap: { availability: "get_stock_balance" },
            allowedTools: ["get_stock_balance"],
            entityTypes: ["catalog_entry"],
            id: "readonly",
            readOnly: true,
            source: "test"
          }
        ]
      },
      enabledIntents: ["stock"],
      intentPhrases: {
        price: [],
        search_product: [],
        stock: [],
        stock_price: []
      },
      tenantId: "generic"
    });

    expect(parseLookupQuery("/avail ABC123", genericProfile)).toMatchObject({
      action: "availability",
      entityType: "catalog_entry",
      intent: "stock",
      keyword: "ABC123",
      status: "parsed"
    });
  });
});
