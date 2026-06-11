import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { loadBusinessProfile } from "../config/businessProfile.js";
import { planBatchLookup } from "../channels/batchLookup.js";
import { resolveTextWithContext, saveLookupContext } from "../channels/chatContext.js";
import { MemoryCacheService } from "../services/cacheService.js";
import type { LookupResult } from "../core/types.js";

const expectationSchema = z.object({
  minTotalFound: z.number().optional(),
  parserPath: z.string().optional(),
  path: z.enum(["channel_context", "lookup"]).optional(),
  policy: z.string().optional(),
  replyIncludes: z.array(z.string()).default([]),
  replyNotIncludes: z.array(z.string()).default([]),
  scope: z.string().optional(),
  source: z.string().optional(),
  statusIn: z.array(z.string()).default([])
});

const turnSchema = z.object({
  expected: expectationSchema.default({ replyIncludes: [], replyNotIncludes: [], statusIn: [] }),
  id: z.string().min(1),
  metricClass: z.enum([
    "batch",
    "coaching",
    "context",
    "fast_path",
    "friendly",
    "guardrail",
    "help",
    "llm_assist",
    "out_of_scope",
    "refinement",
    "sml_lookup"
  ]),
  requiresLlm: z.boolean().default(false),
  text: z.string().min(1)
});

const scenarioSchema = z.object({
  category: z.string().min(1),
  id: z.string().min(1),
  turns: z.array(turnSchema).min(1)
});

const scenarioSuiteSchema = z.object({
  profilePath: z.string().optional(),
  scenarios: z.array(scenarioSchema).min(1),
  schema: z.literal("chatbot_qa_scenarios.v1")
});

export interface ReadinessGateOptions {
  baseUrl: string;
  concurrencyLevels: number[];
  fastPathP95Ms: number;
  includeLlm: boolean;
  includeText: boolean;
  internalApiToken: string;
  outputPath?: string;
  profilePath: string;
  scenarioPath: string;
  smlDependencyErrorMaxRate: number;
  summaryOnly: boolean;
}

export interface ReadinessRecord {
  category: string;
  chatId: string;
  error?: string;
  expectedPath?: string;
  id: string;
  level: "baseline" | number;
  metricClass: z.infer<typeof turnSchema>["metricClass"];
  ms: number;
  parserPath?: string;
  pass: boolean;
  path?: "channel_context" | "lookup";
  policy?: string;
  replyFirstLine?: string;
  scenarioId: string;
  scope?: string;
  source?: string;
  status?: string;
  text?: string;
  textHash: string;
}

export interface ReadinessReport {
  acceptance: {
    fastPathP95Ms?: number;
    fastPathP95Pass: boolean;
    llmAssistMaxMs?: number;
    llmAssistP95Ms?: number;
    outOfScopeAvoidedRate: number;
    outOfScopeAvoidedRatePass: boolean;
    scenarioPassRate: number;
    scenarioPassRatePass: boolean;
    smlDependencyErrorRate: number;
    smlDependencyErrorRatePass: boolean;
  };
  config: {
    baseUrl: string;
    concurrencyLevels: number[];
    fastPathP95Ms: number;
    includeLlm: boolean;
    profilePath: string;
    scenarioPath: string;
    smlDependencyErrorMaxRate: number;
  };
  generatedAt: string;
  ready: boolean;
  records: ReadinessRecord[];
  summary: {
    failed: number;
    passed: number;
    skipped: number;
    total: number;
  };
}

export async function runReadinessGate(options: ReadinessGateOptions): Promise<ReadinessReport> {
  const suite = loadScenarioSuite(options.scenarioPath);
  const profile = loadBusinessProfile(options.profilePath || suite.profilePath || "profiles/construction-demo.json");
  const records: ReadinessRecord[] = [];

  records.push(
    ...(await runScenarioSet({
      baseUrl: options.baseUrl,
      chatPrefix: "baseline",
      includeLlm: options.includeLlm,
      includeText: options.includeText,
      internalApiToken: options.internalApiToken,
      level: "baseline",
      profile,
      scenarios: suite.scenarios
    }))
  );

  for (const level of options.concurrencyLevels) {
    records.push(
      ...(await runConcurrentLevel({
        baseUrl: options.baseUrl,
        includeLlm: options.includeLlm,
        includeText: options.includeText,
        internalApiToken: options.internalApiToken,
        level,
        profile,
        scenarios: suite.scenarios
      }))
    );
  }

  const report = summarizeReadiness(records, options);
  if (options.outputPath) {
    writeFileSync(options.outputPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  return report;
}

export function summarizeReadiness(records: ReadinessRecord[], options: ReadinessGateOptions): ReadinessReport {
  const executed = records.filter((record) => record.status !== "skipped");
  const passed = executed.filter((record) => record.pass).length;
  const failed = executed.length - passed;
  const skipped = records.length - executed.length;
  const scenarioPassRate = executed.length === 0 ? 0 : passed / executed.length;

  const outOfScope = executed.filter((record) => record.metricClass === "out_of_scope");
  const outOfScopeAvoided = outOfScope.filter(
    (record) => record.pass && record.source === "none" && record.parserPath === "none"
  ).length;
  const outOfScopeAvoidedRate = outOfScope.length === 0 ? 1 : outOfScopeAvoided / outOfScope.length;

  const fastPathP95Ms = percentile(
    executed.filter((record) => record.metricClass === "fast_path").map((record) => record.ms),
    0.95
  );
  const llmAssistP95Ms = percentile(
    executed.filter((record) => record.metricClass === "llm_assist").map((record) => record.ms),
    0.95
  );
  const llmAssistMaxMs = max(executed.filter((record) => record.metricClass === "llm_assist").map((record) => record.ms));

  const lookupRecords = executed.filter((record) => record.path === "lookup");
  const dependencyErrors = lookupRecords.filter((record) => record.status === "dependency_error").length;
  const smlDependencyErrorRate = lookupRecords.length === 0 ? 0 : dependencyErrors / lookupRecords.length;

  const acceptance = {
    fastPathP95Ms,
    fastPathP95Pass: fastPathP95Ms == null || fastPathP95Ms <= options.fastPathP95Ms,
    llmAssistMaxMs,
    llmAssistP95Ms,
    outOfScopeAvoidedRate,
    outOfScopeAvoidedRatePass: outOfScopeAvoidedRate === 1,
    scenarioPassRate,
    scenarioPassRatePass: scenarioPassRate >= 0.95,
    smlDependencyErrorRate,
    smlDependencyErrorRatePass: smlDependencyErrorRate <= options.smlDependencyErrorMaxRate
  };

  return {
    acceptance,
    config: {
      baseUrl: options.baseUrl,
      concurrencyLevels: options.concurrencyLevels,
      fastPathP95Ms: options.fastPathP95Ms,
      includeLlm: options.includeLlm,
      profilePath: options.profilePath,
      scenarioPath: options.scenarioPath,
      smlDependencyErrorMaxRate: options.smlDependencyErrorMaxRate
    },
    generatedAt: new Date().toISOString(),
    ready:
      acceptance.fastPathP95Pass &&
      acceptance.outOfScopeAvoidedRatePass &&
      acceptance.scenarioPassRatePass &&
      acceptance.smlDependencyErrorRatePass,
    records,
    summary: {
      failed,
      passed,
      skipped,
      total: records.length
    }
  };
}

function loadScenarioSuite(path: string): z.infer<typeof scenarioSuiteSchema> {
  return scenarioSuiteSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

async function runConcurrentLevel(options: {
  baseUrl: string;
  includeLlm: boolean;
  includeText: boolean;
  internalApiToken: string;
  level: number;
  profile: ReturnType<typeof loadBusinessProfile>;
  scenarios: Array<z.infer<typeof scenarioSchema>>;
}): Promise<ReadinessRecord[]> {
  const scenarios = options.scenarios.filter((scenario) =>
    options.includeLlm ? true : scenario.turns.every((turn) => !turn.requiresLlm)
  );
  const workers = Array.from({ length: options.level }, (_value, index) => {
    const scenario = scenarios[index % scenarios.length];
    return runSingleScenario({
      ...options,
      chatId: `load-${options.level}-${index}`,
      scenario
    });
  });
  return (await Promise.all(workers)).flat();
}

async function runScenarioSet(options: {
  baseUrl: string;
  chatPrefix: string;
  includeLlm: boolean;
  includeText: boolean;
  internalApiToken: string;
  level: "baseline";
  profile: ReturnType<typeof loadBusinessProfile>;
  scenarios: Array<z.infer<typeof scenarioSchema>>;
}): Promise<ReadinessRecord[]> {
  const records: ReadinessRecord[] = [];
  for (const scenario of options.scenarios) {
    if (!options.includeLlm && scenario.turns.some((turn) => turn.requiresLlm)) {
      records.push(
        ...scenario.turns.map((turn) =>
          skippedRecord({
            category: scenario.category,
            chatId: `${options.chatPrefix}-${scenario.id}`,
            includeText: options.includeText,
            level: options.level,
            scenarioId: scenario.id,
            turn
          })
        )
      );
      continue;
    }
    records.push(
      ...(await runSingleScenario({
        ...options,
        chatId: `${options.chatPrefix}-${scenario.id}`,
        scenario
      }))
    );
  }
  return records;
}

async function runSingleScenario(options: {
  baseUrl: string;
  chatId: string;
  includeLlm: boolean;
  includeText: boolean;
  internalApiToken: string;
  level: "baseline" | number;
  profile: ReturnType<typeof loadBusinessProfile>;
  scenario: z.infer<typeof scenarioSchema>;
}): Promise<ReadinessRecord[]> {
  const store = new MemoryCacheService();
  const key = `qa:${options.chatId}`;
  const records: ReadinessRecord[] = [];

  for (const turn of options.scenario.turns) {
    const startedAt = Date.now();
    try {
      const batchPlan = planBatchLookup(turn.text, options.profile, {
        enabled: true,
        maxItems: 5,
        maxTextChars: 1200
      });
      if (batchPlan.kind !== "single") {
        records.push(
          buildRecord({
            category: options.scenario.category,
            chatId: options.chatId,
            expected: turn.expected,
            includeText: options.includeText,
            level: options.level,
            metricClass: turn.metricClass,
            ms: Date.now() - startedAt,
            observed: {
              parserPath: "none",
              path: "channel_context",
              policy: batchPlan.kind === "batch" ? "lookup" : "help",
              reply: batchPlan.kind === "batch" ? batchPlan.items.map((item, index) => `[${index + 1}/${batchPlan.items.length}] ${item}`).join("\n") : batchPlan.text,
              scope: "lookup_like",
              source: "none",
              status: batchPlan.kind === "batch" ? "batch" : "reply"
            },
            scenarioId: options.scenario.id,
            turn
          })
        );
        continue;
      }

      const resolved = await resolveTextWithContext({
        businessProfile: options.profile,
        contextStore: store,
        contextTtlSeconds: 300,
        key,
        text: turn.text
      });

      if (resolved.kind === "reply") {
        records.push(
          buildRecord({
            category: options.scenario.category,
            chatId: options.chatId,
            expected: turn.expected,
            includeText: options.includeText,
            level: options.level,
            metricClass: turn.metricClass,
            ms: Date.now() - startedAt,
            observed: {
              parserPath: resolved.parserPath ?? "none",
              path: "channel_context",
              policy: resolved.replyPolicy ?? "lookup",
              reply: resolved.text,
              scope: resolved.conversationScope ?? "lookup_like",
              source: "none",
              status: "reply"
            },
            scenarioId: options.scenario.id,
            turn
          })
        );
        continue;
      }

      const response = await callInternalLookup(options.baseUrl, options.internalApiToken, {
        chatId: options.chatId,
        text: resolved.text
      });
      await saveLookupContext({
        contextStore: store,
        key,
        result: response.result,
        ttlSeconds: 300
      });
      records.push(
        buildRecord({
          category: options.scenario.category,
          chatId: options.chatId,
          expected: turn.expected,
          includeText: options.includeText,
          level: options.level,
          metricClass: turn.metricClass,
          ms: Date.now() - startedAt,
          observed: {
            parserPath: response.result.parserPath ?? "none",
            path: "lookup",
            policy: response.result.replyPolicy ?? "lookup",
            reply: response.reply,
            scope: response.result.conversationScope ?? "lookup_like",
            source: "source" in response.result ? response.result.source ?? "unknown" : "unknown",
            status: response.result.status,
            totalFound: "totalFound" in response.result ? response.result.totalFound : undefined
          },
          scenarioId: options.scenario.id,
          turn
        })
      );
    } catch (error) {
      records.push({
        category: options.scenario.category,
        chatId: options.chatId,
        error: error instanceof Error ? error.message : String(error),
        expectedPath: turn.expected.path,
        id: turn.id,
        level: options.level,
        metricClass: turn.metricClass,
        ms: Date.now() - startedAt,
        pass: false,
        scenarioId: options.scenario.id,
        status: "error",
        text: options.includeText ? turn.text : undefined,
        textHash: hashText(turn.text)
      });
    }
  }

  return records;
}

async function callInternalLookup(
  baseUrl: string,
  token: string,
  payload: { chatId: string; text: string }
): Promise<{ reply: string; result: LookupResult }> {
  const response = await fetch(`${trimTrailingSlash(baseUrl)}/internal/lookup`, {
    body: JSON.stringify({
      channel: "qa_readiness",
      chatId: payload.chatId,
      text: payload.text,
      userId: "qa-readiness"
    }),
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    method: "POST"
  });
  const body = (await response.json()) as { reply?: string; result?: LookupResult };
  if (!response.ok || !body.result) {
    throw new Error(`internal lookup failed with HTTP ${response.status}`);
  }
  return {
    reply: body.reply ?? "",
    result: body.result
  };
}

function buildRecord(options: {
  category: string;
  chatId: string;
  expected: z.infer<typeof expectationSchema>;
  includeText: boolean;
  level: "baseline" | number;
  metricClass: z.infer<typeof turnSchema>["metricClass"];
  ms: number;
  observed: {
    parserPath: string;
    path: "channel_context" | "lookup";
    policy: string;
    reply: string;
    scope: string;
    source: string;
    status: string;
    totalFound?: number;
  };
  scenarioId: string;
  turn: z.infer<typeof turnSchema>;
}): ReadinessRecord {
  return {
    category: options.category,
    chatId: options.chatId,
    expectedPath: options.expected.path,
    id: options.turn.id,
    level: options.level,
    metricClass: options.metricClass,
    ms: options.ms,
    parserPath: options.observed.parserPath,
    pass: matchesExpectation(options.observed, options.expected),
    path: options.observed.path,
    policy: options.observed.policy,
    replyFirstLine: options.includeText ? firstLine(options.observed.reply) : undefined,
    scenarioId: options.scenarioId,
    scope: options.observed.scope,
    source: options.observed.source,
    status: options.observed.status,
    text: options.includeText ? options.turn.text : undefined,
    textHash: hashText(options.turn.text)
  };
}

function skippedRecord(options: {
  category: string;
  chatId: string;
  includeText: boolean;
  level: "baseline" | number;
  scenarioId: string;
  turn: z.infer<typeof turnSchema>;
}): ReadinessRecord {
  return {
    category: options.category,
    chatId: options.chatId,
    id: options.turn.id,
    level: options.level,
    metricClass: options.turn.metricClass,
    ms: 0,
    pass: true,
    scenarioId: options.scenarioId,
    status: "skipped",
    text: options.includeText ? options.turn.text : undefined,
    textHash: hashText(options.turn.text)
  };
}

function matchesExpectation(
  observed: {
    parserPath: string;
    path: "channel_context" | "lookup";
    policy: string;
    reply: string;
    scope: string;
    source: string;
    status: string;
    totalFound?: number;
  },
  expected: z.infer<typeof expectationSchema>
): boolean {
  if (expected.path && observed.path !== expected.path) return false;
  if (expected.statusIn.length > 0 && !expected.statusIn.includes(observed.status)) return false;
  if (expected.scope && observed.scope !== expected.scope) return false;
  if (expected.parserPath && observed.parserPath !== expected.parserPath) return false;
  if (expected.policy && observed.policy !== expected.policy) return false;
  if (expected.source && observed.source !== expected.source) return false;
  if (expected.minTotalFound != null && (observed.totalFound ?? 0) < expected.minTotalFound) return false;
  for (const text of expected.replyIncludes) {
    if (!observed.reply.includes(text)) return false;
  }
  for (const text of expected.replyNotIncludes) {
    if (observed.reply.includes(text)) return false;
  }
  return true;
}

function parseArgs(argv: string[]): ReadinessGateOptions {
  const args = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith("--")) continue;
    const key = current.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args.set(key, "true");
      continue;
    }
    args.set(key, next);
    index += 1;
  }

  return {
    baseUrl: args.get("base-url") ?? process.env.BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? "3060"}`,
    concurrencyLevels: parseConcurrencyLevels(args.get("concurrency") ?? process.env.QA_CONCURRENCY_LEVELS ?? "5,20,50"),
    fastPathP95Ms: Number(args.get("fast-path-p95-ms") ?? process.env.QA_FAST_PATH_P95_MS ?? "2000"),
    includeLlm: booleanArg(args.get("include-llm") ?? process.env.QA_INCLUDE_LLM),
    includeText: booleanArg(args.get("include-text") ?? process.env.QA_INCLUDE_TEXT),
    internalApiToken: args.get("token") ?? process.env.INTERNAL_API_TOKEN ?? "",
    outputPath: args.get("output") ?? process.env.QA_OUTPUT_PATH,
    profilePath: args.get("profile") ?? process.env.BUSINESS_PROFILE_PATH ?? "profiles/construction-demo.json",
    scenarioPath: args.get("scenarios") ?? process.env.QA_SCENARIOS_PATH ?? "tools/chatbot-qa/fixtures/human-qa-scenarios.json",
    smlDependencyErrorMaxRate: Number(
      args.get("sml-dependency-error-max-rate") ?? process.env.QA_SML_DEPENDENCY_ERROR_MAX_RATE ?? "0"
    ),
    summaryOnly: booleanArg(args.get("summary-only") ?? process.env.QA_SUMMARY_ONLY)
  };
}

function parseConcurrencyLevels(value: string): number[] {
  return value
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item > 0);
}

function percentile(values: number[], rank: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * rank) - 1);
  return sorted[index];
}

function max(values: number[]): number | undefined {
  return values.length === 0 ? undefined : Math.max(...values);
}

function booleanArg(value: string | undefined): boolean {
  return value != null && ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function firstLine(value: string): string {
  return value.split("\n")[0] ?? "";
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/g, "");
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!options.internalApiToken) {
    throw new Error("INTERNAL_API_TOKEN, --token, or QA token is required for readiness gate");
  }

  const report = await runReadinessGate(options);
  console.log(JSON.stringify(options.summaryOnly ? { ...report, records: undefined } : report, null, 2));
  process.exitCode = report.ready ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
