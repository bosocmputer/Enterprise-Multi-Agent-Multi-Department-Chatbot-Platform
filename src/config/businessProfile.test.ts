import { describe, expect, it } from "vitest";
import {
  businessProfileSchema,
  formatBusinessProfileHelp,
  loadBusinessProfile,
  normalizeDomainProfile,
  suggestedReadOnlyMcpTools
} from "./businessProfile.js";

describe("business profile", () => {
  it("loads the construction demo profile", () => {
    const profile = loadBusinessProfile("profiles/construction-demo.json");
    const domain = normalizeDomainProfile(profile);

    expect(profile).toMatchObject({
      businessType: "construction-materials",
      tenantId: "construction-demo",
      sml: {
        datasetLabel: "sml-192.168.2.248",
        tenantStatus: "real"
      }
    });
    const helpText = formatBusinessProfileHelp(profile);
    expect(helpText).toContain("ปูน ราคา");
    expect(formatBusinessProfileHelp(profile)).toContain("ส่งชื่อสินค้า");
    expect(formatBusinessProfileHelp(profile)).toContain("วิธีคุยที่แนะนำ");
    expect(formatBusinessProfileHelp(profile)).toContain("/stock <คำค้น>");
    expect(formatBusinessProfileHelp(profile)).toContain("/price <คำค้น>");
    expect(formatBusinessProfileHelp(profile)).toContain("เพิ่ม - ดูรายการต่อไป");
    expect(formatBusinessProfileHelp(profile)).not.toContain("SML");
    expect(formatBusinessProfileHelp(profile)).not.toContain("ตอนนี้รองรับ");
    expect(helpText.split("\n").filter((line) => line.startsWith("- "))).toHaveLength(3);
    expect(domain).toMatchObject({
      defaultEntityType: "inventory_item",
      connectors: [
        {
          readOnly: true,
          source: "sml"
        }
      ]
    });
    expect(domain.connectors.flatMap((connector) => connector.allowedTools)).not.toContain("create_sale_reserve");
    expect(profile.capabilities.requestable.map((capability) => capability.id)).toEqual(
      expect.arrayContaining(["purchase_cost", "supplier_lookup", "reserved_stock"])
    );
    expect(suggestedReadOnlyMcpTools(profile)).toEqual(
      expect.arrayContaining(["get_product_cost", "get_product_supplier"])
    );
  });

  it("loads the mock auto-parts profile without changing source contracts", () => {
    const profile = loadBusinessProfile("profiles/auto-parts-mock.json");
    const domain = normalizeDomainProfile(profile);

    expect(profile.tenantId).toBe("auto-parts-mock");
    expect(domain.defaultEntityType).toBe("part");
    expect(domain.actions.map((action) => action.id)).toEqual(
      expect.arrayContaining(["search", "availability", "price"])
    );
    expect(domain.connectors[0]).toMatchObject({
      readOnly: true,
      source: "mock-catalog"
    });
  });

  it("rejects invalid intent regex patterns", () => {
    const parsed = businessProfileSchema.safeParse({
      businessType: "test",
      intentPatterns: [{ intent: "stock", pattern: "[" }],
      tenantId: "test"
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects write-like connector tools in read-only profiles", () => {
    const parsed = businessProfileSchema.safeParse({
      businessType: "test",
      domain: {
        version: 2,
        actions: [{ id: "search", legacyIntent: "search_product", phrases: ["find"] }],
        connectors: [
          {
            actionToolMap: { search: "search_product" },
            allowedTools: ["search_product", "create_sale_reserve"],
            id: "bad",
            readOnly: true,
            source: "sml"
          }
        ],
        entities: [{ label: "Entry", type: "entry" }]
      },
      tenantId: "test"
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects write-like suggested MCP tools in requestable capabilities", () => {
    const parsed = businessProfileSchema.safeParse({
      businessType: "test",
      capabilities: {
        requestable: [
          {
            id: "reservation",
            label: "จองสินค้า",
            phrases: ["จอง"],
            suggestedReadOnlyTool: "create_sale_reserve"
          }
        ]
      },
      tenantId: "test"
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects incomplete domain profile v2 config", () => {
    const parsed = businessProfileSchema.safeParse({
      businessType: "test",
      domain: {
        version: 2,
        actions: [],
        connectors: [
          {
            id: "empty",
            readOnly: true,
            source: "source"
          }
        ],
        entities: []
      },
      tenantId: "test"
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const messages = parsed.error.issues.map((issue) => issue.message);
      expect(messages).toEqual(expect.arrayContaining([
        "Domain profile must declare at least one entity type",
        "Domain profile must declare at least one action",
        "Read-only connector must declare allowed tools",
        "Read-only connector must map at least one domain action to a tool"
      ]));
    }
  });

  it("normalizes v1-only profiles into domain profile v2", () => {
    const profile = businessProfileSchema.parse({
      businessType: "generic",
      intentPhrases: {
        price: ["cost"],
        search_product: ["find"],
        stock: ["available"],
        stock_price: ["available cost"]
      },
      tenantId: "generic-demo"
    });

    const domain = normalizeDomainProfile(profile);

    expect(domain.version).toBe(2);
    expect(domain.defaultEntityType).toBe("entity");
    expect(domain.actions.map((action) => [action.id, action.legacyIntent])).toEqual(
      expect.arrayContaining([
        ["search", "search_product"],
        ["availability", "stock"],
        ["price", "price"]
      ])
    );
    expect(domain.connectors[0]?.readOnly).toBe(true);
  });
});
