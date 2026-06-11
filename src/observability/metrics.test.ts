import { describe, expect, it } from "vitest";
import { MetricsRegistry } from "./metrics.js";

describe("MetricsRegistry", () => {
  it("records generic lookup labels for tenant, entity, action, source, and confidence band", () => {
    const metrics = new MetricsRegistry();

    metrics.recordLookup(
      "telegram",
      {
        action: "price",
        cacheHit: false,
        datasetLabel: "test",
        entityType: "inventory_item",
        intent: "price",
        prices: [{ price: 10, unitName: "ชิ้น" }],
        product: {
          code: "A001",
          entity: { id: "A001", label: "Entry A", type: "inventory_item" },
          name: "Entry A"
        },
        source: "sml",
        status: "success",
        tenantId: "construction-demo",
        tenantStatus: "real"
      },
      42
    );

    const rendered = metrics.renderPrometheus();
    expect(rendered).toContain('tenant="construction-demo"');
    expect(rendered).toContain('entity_type="inventory_item"');
    expect(rendered).toContain('action="price"');
    expect(rendered).toContain('source="sml"');
    expect(rendered).toContain('confidence_band="high"');
  });
});
