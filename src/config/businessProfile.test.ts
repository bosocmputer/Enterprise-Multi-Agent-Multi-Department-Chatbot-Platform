import { describe, expect, it } from "vitest";
import {
  businessProfileSchema,
  formatBusinessProfileHelp,
  loadBusinessProfile,
  normalizeDomainProfile
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
    expect(formatBusinessProfileHelp(profile)).toContain("มีปูนเหลือไหม");
    expect(formatBusinessProfileHelp(profile)).toContain("ส่งชื่อสินค้า");
    expect(formatBusinessProfileHelp(profile)).not.toContain("ตอนนี้รองรับ");
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
        connectors: [
          {
            allowedTools: ["search_product", "create_sale_reserve"],
            id: "bad",
            readOnly: true,
            source: "sml"
          }
        ]
      },
      tenantId: "test"
    });

    expect(parsed.success).toBe(false);
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
