import type pino from "pino";
import type { AppConfig } from "../config/env.js";
import { hashIdentifier, hashText } from "../core/hash.js";
import type { ConversationMetadata, LookupResult } from "../core/types.js";

export interface QaTraceConfig {
  enabled: boolean;
  includeBotReply: boolean;
  includeRawText: boolean;
  maxTextChars: number;
  redactSecrets: boolean;
  sampleRate: number;
  ttlDays: number;
}

export interface QaTraceEvent {
  botReply?: string;
  businessType?: string;
  channel: string;
  chatId?: string;
  decision?: Record<string, unknown>;
  inputText?: string;
  metadata?: ConversationMetadata;
  normalizedText?: string;
  result?: LookupResult;
  tenantId: string;
  userId?: string;
}

export function qaTraceConfigFromAppConfig(config: AppConfig): QaTraceConfig {
  return {
    enabled: config.QA_TRACE_ENABLED,
    includeBotReply: config.QA_TRACE_INCLUDE_BOT_REPLY,
    includeRawText: config.QA_TRACE_INCLUDE_RAW_TEXT,
    maxTextChars: config.QA_TRACE_MAX_TEXT_CHARS,
    redactSecrets: config.QA_TRACE_REDACT_SECRETS,
    sampleRate: config.QA_TRACE_SAMPLE_RATE,
    ttlDays: config.QA_TRACE_TTL_DAYS
  };
}

export function logQaTrace(logger: pino.Logger | undefined, config: QaTraceConfig | undefined, event: QaTraceEvent): void {
  if (!logger || !config?.enabled) return;
  if (!shouldSample(event.inputText ?? event.normalizedText ?? event.botReply ?? "", config.sampleRate)) return;

  const decision = event.result ? decisionFromResult(event.result) : event.decision ?? decisionFromMetadata(event.metadata);
  const payload: Record<string, unknown> = {
    botReplyHash: hashText(event.botReply),
    businessType: event.businessType,
    channel: event.channel,
    chatHash: hashIdentifier(event.chatId),
    decisionTrace: decision,
    event: "qa_trace",
    inputTextHash: hashText(event.inputText),
    normalizedTextHash: hashText(event.normalizedText),
    qaTraceRetentionDays: config.ttlDays,
    tenantId: event.tenantId,
    userHash: hashIdentifier(event.userId)
  };

  if (config.includeRawText && event.inputText != null) {
    payload.rawText = sanitizeTraceText(event.inputText, config);
  }
  if (config.includeRawText && event.normalizedText != null && event.normalizedText !== event.inputText) {
    payload.normalizedText = sanitizeTraceText(event.normalizedText, config);
  }
  if (config.includeBotReply && event.botReply != null) {
    payload.botReply = sanitizeTraceText(event.botReply, config);
  }

  try {
    logger.info(payload, "qa trace");
  } catch {
    // QA trace is diagnostic only; never fail the user-facing reply path because logging failed.
  }
}

export function sanitizeTraceText(text: string, config: Pick<QaTraceConfig, "maxTextChars" | "redactSecrets">): string {
  const redacted = config.redactSecrets ? redactSensitiveText(text) : text;
  if (config.maxTextChars <= 0 || redacted.length <= config.maxTextChars) return redacted;
  return `${redacted.slice(0, config.maxTextChars)}...[truncated ${redacted.length - config.maxTextChars} chars]`;
}

function shouldSample(text: string, sampleRate: number): boolean {
  if (sampleRate <= 0) return false;
  if (sampleRate >= 1) return true;
  const hash = hashText(text) ?? "00000000";
  const bucket = Number.parseInt(hash.slice(0, 8), 16) / 0xffffffff;
  return bucket <= sampleRate;
}

function decisionFromMetadata(metadata?: ConversationMetadata): Record<string, unknown> {
  return {
    conversationScope: metadata?.conversationScope,
    outOfScopeCategory: metadata?.outOfScopeCategory,
    parserPath: metadata?.parserPath,
    replyPolicy: metadata?.replyPolicy,
    status: "context_or_policy_reply"
  };
}

function decisionFromResult(result: LookupResult): Record<string, unknown> {
  const common = {
    action: "action" in result ? result.action : undefined,
    assist: result.assist
      ? {
          durationMs: result.assist.durationMs,
          model: result.assist.model,
          outcome: result.assist.outcome,
          provider: result.assist.provider,
          reason: result.assist.reason,
          status: result.assist.status,
          timeoutMs: result.assist.timeoutMs,
          used: true
        }
      : { used: false },
    conversationScope: result.conversationScope,
    entityType: "entityType" in result ? result.entityType : undefined,
    outOfScopeCategory: result.outOfScopeCategory,
    parserPath: result.parserPath,
    replyPolicy: result.replyPolicy,
    source: "source" in result ? result.source : undefined,
    status: result.status,
    tenantId: "tenantId" in result ? result.tenantId : undefined
  };

  if (result.status === "success") {
    return {
      ...common,
      cacheHit: result.cacheHit,
      datasetLabel: result.datasetLabel,
      entityId: result.entity?.id ?? result.product.code,
      hasPrice: Boolean(result.prices?.length),
      hasStock: Boolean(result.stock?.length),
      intent: result.intent,
      tenantStatus: result.tenantStatus
    };
  }
  if (result.status === "multiple_matches") {
    return {
      ...common,
      candidateCount: result.candidates.length,
      hasMore: result.hasMore,
      intent: result.intent,
      keywordHash: hashText(result.keyword),
      pageSize: result.pageSize,
      pageStart: result.pageStart,
      resultQuality: result.resultQuality,
      returned: result.returned,
      totalFound: result.totalFound
    };
  }
  if (result.status === "no_match" || result.status === "needs_refinement") {
    return {
      ...common,
      intent: result.intent,
      keywordHash: hashText(result.keyword),
      resultQuality: "resultQuality" in result ? result.resultQuality : undefined
    };
  }
  if (result.status === "capability_gap") {
    return {
      ...common,
      capabilityId: result.capabilityId,
      capabilityLabel: result.capabilityLabel,
      requiredFields: result.requiredFields,
      suggestedReadOnlyTool: result.suggestedReadOnlyTool
    };
  }
  if (result.status === "dependency_error" || result.status === "unsupported") {
    return {
      ...common,
      reason: result.reason
    };
  }
  return common;
}

function redactSensitiveText(text: string): string {
  return text
    .replace(/\b\d{7,}:[A-Za-z0-9_-]{20,}\b/g, "[REDACTED_TELEGRAM_TOKEN]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_API_KEY]")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 [REDACTED_AUTH]")
    .replace(/\b(password|pass|token|api[_-]?key|secret)\s*[:=]\s*([^\s,;]+)/gi, "$1=[REDACTED_SECRET]")
    .replace(
      /(^|[\s,;])(phone|tel|mobile|account|card|เบอร์|โทร|เลขบัญชี|บัญชี|บัตร)\s*[:=]?\s*\d{9,18}\b/gi,
      "$1$2=[REDACTED_NUMBER]"
    );
}
