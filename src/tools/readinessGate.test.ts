import { describe, expect, it } from "vitest";
import { summarizeReadiness, type ReadinessGateOptions, type ReadinessRecord } from "./readinessGate.js";

const options: ReadinessGateOptions = {
  baseUrl: "http://127.0.0.1:3060",
  concurrencyLevels: [5],
  fastPathP95Ms: 500,
  includeLlm: false,
  includeText: false,
  internalApiToken: "test-token",
  profilePath: "profiles/construction-demo.json",
  scenarioPath: "tools/chatbot-qa/fixtures/human-qa-scenarios.json",
  smlDependencyErrorMaxRate: 0,
  summaryOnly: false
};

function record(overrides: Partial<ReadinessRecord>): ReadinessRecord {
  return {
    category: "test",
    chatId: "chat",
    id: "turn",
    level: "baseline",
    metricClass: "fast_path",
    ms: 10,
    pass: true,
    path: "lookup",
    parserPath: "deterministic",
    policy: "lookup",
    scenarioId: "scenario",
    scope: "lookup_like",
    source: "sml",
    status: "success",
    textHash: "abc123",
    ...overrides
  };
}

describe("readiness gate summary", () => {
  it("passes when scenario, out-of-scope, fast-path, and dependency gates pass", () => {
    const report = summarizeReadiness(
      [
        record({ metricClass: "fast_path", ms: 120 }),
        record({
          metricClass: "out_of_scope",
          parserPath: "none",
          path: "channel_context",
          policy: "refuse_redirect",
          scope: "out_of_scope_current_info",
          source: "none",
          status: "reply"
        })
      ],
      options
    );

    expect(report.ready).toBe(true);
    expect(report.acceptance.scenarioPassRate).toBe(1);
    expect(report.acceptance.outOfScopeAvoidedRate).toBe(1);
    expect(report.acceptance.fastPathP95Ms).toBe(120);
  });

  it("fails when out-of-scope traffic reaches a connector path", () => {
    const report = summarizeReadiness(
      [
        record({ metricClass: "fast_path", ms: 120 }),
        record({
          metricClass: "out_of_scope",
          parserPath: "deterministic",
          path: "lookup",
          policy: "lookup",
          scope: "lookup_like",
          source: "sml",
          status: "no_match"
        })
      ],
      options
    );

    expect(report.ready).toBe(false);
    expect(report.acceptance.outOfScopeAvoidedRatePass).toBe(false);
  });

  it("fails when fast-path p95 exceeds the acceptance threshold", () => {
    const report = summarizeReadiness(
      [
        record({ metricClass: "fast_path", ms: 120 }),
        record({ metricClass: "fast_path", ms: 900 })
      ],
      options
    );

    expect(report.ready).toBe(false);
    expect(report.acceptance.fastPathP95Pass).toBe(false);
  });
});
