import type { ConversationMetadata, LookupResult } from "../core/types.js";

type Labels = Record<string, string | number | boolean | undefined>;

interface CounterMetric {
  help: string;
  type: "counter";
  values: Map<string, { labels: Record<string, string>; value: number }>;
}

interface HistogramMetric {
  buckets: number[];
  help: string;
  type: "histogram";
  values: Map<
    string,
    {
      bucketCounts: number[];
      count: number;
      labels: Record<string, string>;
      sum: number;
    }
  >;
}

type Metric = CounterMetric | HistogramMetric;

export class MetricsRegistry {
  private readonly metrics = new Map<string, Metric>();

  counter(name: string, help: string, labels: Labels = {}, increment = 1): void {
    const metric = this.getOrCreateCounter(name, help);
    const normalized = normalizeLabels(labels);
    const key = labelsKey(normalized);
    const current = metric.values.get(key) ?? { labels: normalized, value: 0 };
    current.value += increment;
    metric.values.set(key, current);
  }

  histogram(name: string, help: string, value: number, labels: Labels = {}, buckets = defaultBuckets): void {
    const metric = this.getOrCreateHistogram(name, help, buckets);
    const normalized = normalizeLabels(labels);
    const key = labelsKey(normalized);
    const current =
      metric.values.get(key) ??
      {
        bucketCounts: Array.from({ length: metric.buckets.length }, () => 0),
        count: 0,
        labels: normalized,
        sum: 0
      };

    metric.buckets.forEach((bucket, index) => {
      if (value <= bucket) current.bucketCounts[index] += 1;
    });
    current.count += 1;
    current.sum += value;
    metric.values.set(key, current);
  }

  recordLookup(channel: string, result: LookupResult, durationMs: number): void {
    const labels = {
      action: "action" in result ? result.action ?? "none" : "none",
      channel,
      confidence_band: confidenceBand(result),
      conversation_scope: conversationScope(result),
      entity_type: "entityType" in result ? result.entityType ?? "unknown" : "unknown",
      intent: "intent" in result ? result.intent : "none",
      cache_hit: "cacheHit" in result ? String(result.cacheHit) : "none",
      out_of_scope_category: result.outOfScopeCategory ?? "none",
      parser_path: parserPath(result),
      reply_policy: replyPolicy(result),
      source: "source" in result ? result.source ?? "unknown" : "unknown",
      status: result.status,
      tenant: "tenantId" in result ? result.tenantId ?? "unknown" : "unknown"
    };
    this.counter("parts_lookup_requests_total", "Lookup requests by channel and outcome.", labels);
    this.histogram("parts_lookup_duration_ms", "Lookup duration in milliseconds.", durationMs, labels);
  }

  recordTelegramUpdate(outcome: "handled" | "ignored" | "failed", reason = "none"): void {
    this.recordChannelUpdate("telegram", outcome, reason);
    this.counter("parts_lookup_telegram_updates_total", "Telegram updates by outcome.", { outcome, reason });
  }

  recordChannelUpdate(channel: string, outcome: "handled" | "ignored" | "failed", reason = "none"): void {
    this.counter("parts_lookup_channel_updates_total", "Channel updates by channel and outcome.", {
      channel,
      outcome,
      reason
    });
  }

  recordConversationScope(channel: string, tenant: string, metadata: ConversationMetadata = {}): void {
    this.counter("parts_lookup_conversation_scope_total", "Conversation scope outcomes by channel and reply policy.", {
      channel,
      conversation_scope: metadata.conversationScope ?? "lookup_like",
      out_of_scope_category: metadata.outOfScopeCategory ?? "none",
      parser_path: metadata.parserPath ?? "none",
      reply_policy: metadata.replyPolicy ?? "lookup",
      tenant
    });
  }

  recordSmlTool(tool: string, outcome: string, durationMs: number): void {
    const labels = { tool, outcome };
    this.counter("parts_lookup_sml_tool_calls_total", "SML MCP tool calls by outcome.", labels);
    this.histogram("parts_lookup_sml_tool_duration_ms", "SML MCP tool duration in milliseconds.", durationMs, labels);
  }

  recordLlmParse(mode: string, model: string, outcome: string, durationMs: number): void {
    const labels = { mode, model, outcome };
    this.counter("parts_lookup_llm_parse_total", "LLM parser attempts by mode and outcome.", labels);
    this.histogram("parts_lookup_llm_parse_duration_ms", "LLM parser duration in milliseconds.", durationMs, {
      model,
      outcome
    });
  }

  recordLlmAssistStarted(mode: string, model: string, reason: string): void {
    this.counter("parts_lookup_llm_assist_started_total", "LLM assist slow-path starts by mode, model, and reason.", {
      mode,
      model,
      reason
    });
  }

  renderPrometheus(): string {
    const lines: string[] = [];
    for (const [name, metric] of [...this.metrics.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(`# HELP ${name} ${metric.help}`);
      lines.push(`# TYPE ${name} ${metric.type}`);
      if (metric.type === "counter") {
        for (const value of [...metric.values.values()].sort(compareMetricValues)) {
          lines.push(`${name}${formatLabels(value.labels)} ${value.value}`);
        }
      } else {
        for (const value of [...metric.values.values()].sort(compareMetricValues)) {
          metric.buckets.forEach((bucket, index) => {
            lines.push(`${name}_bucket${formatLabels({ ...value.labels, le: String(bucket) })} ${value.bucketCounts[index]}`);
          });
          lines.push(`${name}_bucket${formatLabels({ ...value.labels, le: "+Inf" })} ${value.count}`);
          lines.push(`${name}_sum${formatLabels(value.labels)} ${roundMetric(value.sum)}`);
          lines.push(`${name}_count${formatLabels(value.labels)} ${value.count}`);
        }
      }
    }
    return `${lines.join("\n")}\n`;
  }

  private getOrCreateCounter(name: string, help: string): CounterMetric {
    const existing = this.metrics.get(name);
    if (existing) {
      if (existing.type !== "counter") throw new Error(`Metric ${name} is already a ${existing.type}`);
      return existing;
    }
    const metric: CounterMetric = { help, type: "counter", values: new Map() };
    this.metrics.set(name, metric);
    return metric;
  }

  private getOrCreateHistogram(name: string, help: string, buckets: number[]): HistogramMetric {
    const existing = this.metrics.get(name);
    if (existing) {
      if (existing.type !== "histogram") throw new Error(`Metric ${name} is already a ${existing.type}`);
      return existing;
    }
    const metric: HistogramMetric = { buckets, help, type: "histogram", values: new Map() };
    this.metrics.set(name, metric);
    return metric;
  }
}

export const defaultMetrics = new MetricsRegistry();

const defaultBuckets = [25, 50, 100, 250, 500, 1000, 2000, 5000];

function normalizeLabels(labels: Labels): Record<string, string> {
  return Object.fromEntries(
    Object.entries(labels)
      .filter((entry): entry is [string, string | number | boolean] => entry[1] != null)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => [key, String(value).replace(/[^a-zA-Z0-9_.:-]/g, "_")])
  );
}

function labelsKey(labels: Record<string, string>): string {
  return JSON.stringify(labels);
}

function formatLabels(labels: Record<string, string>): string {
  const entries = Object.entries(labels);
  if (entries.length === 0) return "";
  return `{${entries.map(([key, value]) => `${key}="${escapeLabel(value)}"`).join(",")}}`;
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function compareMetricValues(
  a: { labels: Record<string, string> },
  b: { labels: Record<string, string> }
): number {
  return labelsKey(a.labels).localeCompare(labelsKey(b.labels));
}

function roundMetric(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function confidenceBand(result: LookupResult): "high" | "low" | "medium" | "none" {
  if ("assist" in result && result.assist?.status === "parsed") return "medium";
  if ("assist" in result && result.assist?.status === "rejected") return "low";
  if (result.status === "unsupported" || result.status === "dependency_error") return "none";
  return "high";
}

function conversationScope(result: LookupResult): string {
  return result.conversationScope ?? (result.status === "unsupported" ? "lookup_like" : "lookup_like");
}

function parserPath(result: LookupResult): string {
  if (result.parserPath) return result.parserPath;
  if (result.assist) return "llm_assist";
  if (result.status === "unsupported") return "none";
  return "deterministic";
}

function replyPolicy(result: LookupResult): string {
  return result.replyPolicy ?? (result.status === "unsupported" ? "help" : "lookup");
}
