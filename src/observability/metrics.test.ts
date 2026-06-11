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
    expect(rendered).toContain('conversation_scope="lookup_like"');
    expect(rendered).toContain('out_of_scope_category="none"');
    expect(rendered).toContain('parser_path="deterministic"');
    expect(rendered).toContain('reply_policy="lookup"');
  });

  it("records conversation scope labels for context replies", () => {
    const metrics = new MetricsRegistry();

    metrics.recordConversationScope("telegram", "construction-demo", {
      conversationScope: "out_of_scope_current_info",
      outOfScopeCategory: "current_info",
      parserPath: "none",
      replyPolicy: "refuse_redirect"
    });

    const rendered = metrics.renderPrometheus();
    expect(rendered).toContain("parts_lookup_conversation_scope_total");
    expect(rendered).toContain('channel="telegram"');
    expect(rendered).toContain('tenant="construction-demo"');
    expect(rendered).toContain('conversation_scope="out_of_scope_current_info"');
    expect(rendered).toContain('out_of_scope_category="current_info"');
    expect(rendered).toContain('parser_path="none"');
    expect(rendered).toContain('reply_policy="refuse_redirect"');
  });
});
