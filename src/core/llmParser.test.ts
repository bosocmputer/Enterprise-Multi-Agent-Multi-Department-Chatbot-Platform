import { describe, expect, it } from "vitest";
import { loadBusinessProfile } from "../config/businessProfile.js";
import { LiteLlmClientError, type LiteLlmClient } from "../integrations/litellmClient.js";
import { BusinessProfileLlmParser, ThrottledLlmParser, runLlmParseWithTelemetry } from "./llmParser.js";
import { MetricsRegistry } from "../observability/metrics.js";

const profile = loadBusinessProfile("profiles/construction-demo.json");

function parserFor(contentOrError: string | Error, minConfidence = 0.75) {
  return new BusinessProfileLlmParser({
    client: {
      createJsonChatCompletion: async () => {
        if (contentOrError instanceof Error) throw contentOrError;
        return {
          content: contentOrError,
          model: "openrouter/openrouter/free"
        };
      }
    } as unknown as LiteLlmClient,
    metadata: {
      model: "openrouter/openrouter/free",
      provider: "litellm",
      timeoutMs: 6000
    },
    minConfidence,
    profile
  });
}

describe("BusinessProfileLlmParser", () => {
  it("accepts valid JSON parser output", async () => {
    const parser = parserFor(
      JSON.stringify({
        confidence: 0.98,
        intent: "stock",
        keyword: "ปูนตราช้าง",
        searchTerms: ["ปูนตราช้าง"]
      })
    );

    await expect(parser.parse("มีปูนตราช้างเหลือไหม")).resolves.toMatchObject({
      confidence: 0.98,
      intent: "stock",
      keyword: "ปูนตราช้าง",
      searchTerms: ["ปูนตราช้าง"],
      status: "parsed"
    });
  });

  it("accepts generic domain parser output", async () => {
    const parser = parserFor(
      JSON.stringify({
        action: "availability",
        confidence: 0.96,
        entityType: "inventory_item",
        query: "ปูนตราช้าง",
        searchTerms: ["ปูนตราช้าง"]
      })
    );

    await expect(parser.parse("มีปูนตราช้างเหลือไหม")).resolves.toMatchObject({
      action: "availability",
      confidence: 0.96,
      entityType: "inventory_item",
      intent: "stock",
      keyword: "ปูนตราช้าง",
      query: "ปูนตราช้าง",
      searchTerms: ["ปูนตราช้าง"],
      status: "parsed"
    });
  });

  it("accepts requestable capability gaps from the profile enum", async () => {
    const parser = parserFor(
      JSON.stringify({
        capability: "purchase_cost",
        confidence: 0.96,
        entityType: "inventory_item",
        intent: "unsupported",
        query: "PAINT-01424 ราคาทุน",
        searchTerms: ["PAINT-01424"]
      })
    );

    await expect(parser.parse("PAINT-01424 ราคาทุน")).resolves.toMatchObject({
      capabilityGap: {
        capabilityId: "purchase_cost",
        capabilityLabel: "ราคาทุน/ต้นทุน",
        suggestedReadOnlyTool: "get_product_cost"
      },
      intent: "unsupported",
      status: "parsed"
    });
  });

  it("rejects capability ids that are not declared in the profile", async () => {
    await expect(
      parserFor(
        JSON.stringify({
          capability: "drop_database",
          confidence: 0.96,
          intent: "unsupported",
          query: "ขอลบข้อมูล",
          searchTerms: ["ขอลบข้อมูล"]
        })
      ).parse("ขอลบข้อมูล")
    ).resolves.toMatchObject({
      reason: "invalid_schema",
      status: "rejected"
    });
  });

  it("rejects malformed JSON", async () => {
    await expect(parserFor("{").parse("มีปูนไหม")).resolves.toMatchObject({
      reason: "invalid_json",
      status: "rejected"
    });
  });

  it("rejects hallucinated or unsupported intent enum values", async () => {
    await expect(
      parserFor(
        JSON.stringify({
          confidence: 0.95,
          intent: "inventory_inquiry",
          keyword: "ปูน",
          searchTerms: ["ปูน"]
        })
      ).parse("มีปูนไหม")
    ).resolves.toMatchObject({
      reason: "invalid_schema",
      status: "rejected"
    });
  });

  it("rejects actions not allowed by the domain profile", async () => {
    await expect(
      parserFor(
        JSON.stringify({
          action: "delete",
          confidence: 0.95,
          entityType: "inventory_item",
          query: "ปูน",
          searchTerms: ["ปูน"]
        })
      ).parse("มีปูนไหม")
    ).resolves.toMatchObject({
      reason: "invalid_schema",
      status: "rejected"
    });
  });

  it("rejects empty keywords", async () => {
    await expect(
      parserFor(
        JSON.stringify({
          confidence: 0.95,
          intent: "stock",
          keyword: "",
          searchTerms: []
        })
      ).parse("มีไหม")
    ).resolves.toMatchObject({
      reason: "invalid_schema",
      status: "rejected"
    });
  });

  it("rejects empty search terms", async () => {
    await expect(
      parserFor(
        JSON.stringify({
          confidence: 0.95,
          intent: "stock",
          keyword: "ปูน",
          searchTerms: []
        })
      ).parse("มีปูนไหม")
    ).resolves.toMatchObject({
      reason: "invalid_schema",
      status: "rejected"
    });
  });

  it("rejects low confidence output", async () => {
    await expect(
      parserFor(
        JSON.stringify({
          confidence: 0.5,
          intent: "stock",
          keyword: "ปูน",
          searchTerms: ["ปูน"]
        })
      ).parse("มีปูนไหม")
    ).resolves.toMatchObject({
      reason: "low_confidence",
      status: "rejected"
    });
  });

  it("rejects timeouts safely", async () => {
    await expect(
      parserFor(new LiteLlmClientError("timeout", "timeout")).parse("มีปูนไหม")
    ).resolves.toMatchObject({
      reason: "timeout",
      status: "rejected"
    });
  });

  it("rejects truncated LiteLLM completions", async () => {
    const parser = new BusinessProfileLlmParser({
      client: {
        createJsonChatCompletion: async () => ({
          content: JSON.stringify({
            confidence: 0.95,
            intent: "stock",
            keyword: "ปูน",
            searchTerms: ["ปูน"]
          }),
          finishReason: "length",
          model: "openrouter/openrouter/free"
        })
      } as unknown as LiteLlmClient,
      metadata: {
        model: "openrouter/openrouter/free",
        provider: "litellm",
        timeoutMs: 6000
      },
      minConfidence: 0.75,
      profile
    });

    await expect(parser.parse("มีปูนไหม")).resolves.toMatchObject({
      reason: "truncated",
      status: "rejected"
    });
  });

  it("records parser metrics through telemetry", async () => {
    const metrics = new MetricsRegistry();
    const parser = parserFor(
      JSON.stringify({
        confidence: 0.95,
        intent: "stock",
        keyword: "ปูน",
        searchTerms: ["ปูน"]
      })
    );

    await runLlmParseWithTelemetry(parser, "มีปูนไหม", { metrics, mode: "shadow" });

    const rendered = metrics.renderPrometheus();
    expect(rendered).toContain("parts_lookup_llm_parse_total");
    expect(rendered).toContain('mode="shadow"');
    expect(rendered).toContain('outcome="parsed"');
  });

  it("turns unexpected parser throws into provider-error telemetry", async () => {
    const metrics = new MetricsRegistry();
    const result = await runLlmParseWithTelemetry(
      {
        metadata: {
          model: "openrouter/openrouter/free",
          provider: "litellm",
          timeoutMs: 6000
        },
        parse: async () => {
          throw new Error("boom");
        }
      },
      "มีปูนไหม",
      { metrics, mode: "assist" }
    );

    expect(result).toMatchObject({
      model: "openrouter/openrouter/free",
      outcome: "rejected_provider_error",
      reason: "provider_error",
      status: "rejected"
    });
    expect(metrics.renderPrometheus()).toContain('outcome="rejected_provider_error"');
  });

  it("rejects LLM calls that wait beyond the configured queue budget", async () => {
    let releaseFirstCall: (() => void) | undefined;
    const parser = new ThrottledLlmParser({
      maxConcurrentCalls: 1,
      parser: {
        metadata: {
          model: "openrouter/openrouter/free",
          provider: "litellm",
          timeoutMs: 6000
        },
        parse: async () =>
          new Promise((resolve) => {
            releaseFirstCall = () =>
              resolve({
                confidence: 0.95,
                intent: "stock",
                keyword: "ปูน",
                query: "ปูน",
                searchTerms: ["ปูน"],
                status: "parsed"
              });
          })
      },
      queueWaitMs: 1
    });

    const first = parser.parse("มีปูนไหม");
    await expect(parser.parse("มีปูนอีกไหม")).resolves.toMatchObject({
      reason: "queue_timeout",
      status: "rejected"
    });
    releaseFirstCall?.();
    await expect(first).resolves.toMatchObject({ status: "parsed" });
  });

  it("queues LLM calls when a slot opens before the queue budget expires", async () => {
    let releaseFirstCall: (() => void) | undefined;
    let callCount = 0;
    const parser = new ThrottledLlmParser({
      maxConcurrentCalls: 1,
      parser: {
        metadata: {
          model: "openrouter/openrouter/free",
          provider: "litellm",
          timeoutMs: 6000
        },
        parse: async () => {
          callCount += 1;
          if (callCount === 1) {
            return new Promise((resolve) => {
              releaseFirstCall = () =>
                resolve({
                  confidence: 0.95,
                  intent: "stock",
                  keyword: "ปูน",
                  query: "ปูน",
                  searchTerms: ["ปูน"],
                  status: "parsed"
                });
            });
          }
          return {
            confidence: 0.96,
            intent: "price",
            keyword: "น้ำมัน",
            query: "น้ำมัน",
            searchTerms: ["น้ำมัน"],
            status: "parsed"
          };
        }
      },
      queueWaitMs: 100
    });

    const first = parser.parse("มีปูนไหม");
    await Promise.resolve();
    const second = parser.parse("น้ำมัน ราคา");
    await Promise.resolve();
    releaseFirstCall?.();

    await expect(first).resolves.toMatchObject({ status: "parsed" });
    await expect(second).resolves.toMatchObject({
      intent: "price",
      keyword: "น้ำมัน",
      status: "parsed"
    });
  });
});
