import { describe, expect, it } from "vitest";
import { loadBusinessProfile } from "../config/businessProfile.js";
import { LiteLlmClientError, type LiteLlmClient } from "../integrations/litellmClient.js";
import { BusinessProfileLlmParser, runLlmParseWithTelemetry } from "./llmParser.js";
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
});
