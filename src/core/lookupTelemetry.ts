import { createHash } from "node:crypto";
import type pino from "pino";
import type { MetricsRegistry } from "../observability/metrics.js";
import type { LookupOrchestrator } from "./lookupOrchestrator.js";
import type { LlmAssistStartEvent, LookupRequest, LookupResult } from "./types.js";

export async function runLookupWithTelemetry(
  lookup: LookupOrchestrator,
  request: LookupRequest,
  options: {
    logger?: pino.Logger;
    metrics?: MetricsRegistry;
    onAssistStart?: (event: LlmAssistStartEvent) => void | Promise<void>;
  } = {}
): Promise<LookupResult> {
  const startedAt = Date.now();
  const result = await lookup.lookup(request, options);
  const durationMs = Date.now() - startedAt;
  const channel = request.channel ?? "internal";

  options.metrics?.recordLookup(channel, result, durationMs);
  options.logger?.info(
    {
      action: "action" in result ? result.action : undefined,
      cacheHit: "cacheHit" in result ? result.cacheHit : undefined,
      channel,
      chatHash: hashIdentifier(request.chatId),
      dataset: "datasetLabel" in result ? result.datasetLabel : undefined,
      durationMs,
      entityType: "entityType" in result ? result.entityType : undefined,
      intent: "intent" in result ? result.intent : undefined,
      source: "source" in result ? result.source : undefined,
      status: result.status,
      tenantId: "tenantId" in result ? result.tenantId : undefined,
      userHash: hashIdentifier(request.userId)
    },
    "lookup completed"
  );

  return result;
}

function hashIdentifier(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}
