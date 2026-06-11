import type pino from "pino";
import { allDomainPhrases, type BusinessProfile } from "../config/businessProfile.js";
import type { LookupOrchestrator } from "../core/lookupOrchestrator.js";
import { runLookupWithTelemetry } from "../core/lookupTelemetry.js";
import { classifyCapabilityGapText } from "../core/capabilityClassifier.js";
import { classifyNonLookupText, metadataForNonLookupKind } from "../core/nonLookupGuard.js";
import { parseLookupQuery } from "../core/queryParser.js";
import { formatLookupReply } from "../core/responseFormatter.js";
import type { ConversationMetadata, LlmAssistStartEvent, LookupResult } from "../core/types.js";
import type { MetricsRegistry } from "../observability/metrics.js";
import { parseIntentOnly, resolveTextWithContext } from "./chatContext.js";

export interface BatchLookupConfig {
  enabled?: boolean;
  maxItems?: number;
  maxTextChars?: number;
}

export type BatchLookupPlan =
  | { kind: "single" }
  | { kind: "batch"; items: string[] }
  | { kind: "reply"; itemCount: number; outcome: "mixed" | "too_long" | "too_many"; text: string };

export interface BatchLookupRunOptions {
  assistResultFooterEnabled?: boolean;
  assistShowModel?: boolean;
  businessProfile: BusinessProfile;
  capabilityGapShowTechnicalHint?: boolean;
  channel: string;
  chatId?: string;
  logger?: pino.Logger;
  lookup: LookupOrchestrator;
  metrics?: MetricsRegistry;
  onAssistStart?: (event: LlmAssistStartEvent) => void | Promise<void>;
  onResult?: (result: LookupResult) => Promise<void>;
  userId?: string;
}

export interface BatchLookupRunResult {
  outcomes: string[];
  replies: string[];
  traceItems: BatchLookupTraceItem[];
}

export interface BatchLookupTraceItem {
  botReply: string;
  decision?: Record<string, unknown>;
  inputText: string;
  metadata?: ConversationMetadata;
  outcome: string;
  result?: LookupResult;
}

export function planBatchLookup(text: string, profile: BusinessProfile, config: BatchLookupConfig): BatchLookupPlan {
  if (!config.enabled) return { kind: "single" };
  const items = splitBatchItems(text);
  if (items.length <= 1) return { kind: "single" };

  const maxItems = Math.max(1, config.maxItems ?? 5);
  const maxTextChars = Math.max(1, config.maxTextChars ?? 1200);
  if (text.length > maxTextChars) {
    return {
      kind: "reply",
      itemCount: items.length,
      outcome: "too_long",
      text: formatTemplate(profile.replyStyle.batchTooLongMessage, { maxChars: maxTextChars, maxItems })
    };
  }
  if (items.length > maxItems) {
    return {
      kind: "reply",
      itemCount: items.length,
      outcome: "too_many",
      text: formatTemplate(profile.replyStyle.batchTooManyMessage, { maxChars: maxTextChars, maxItems })
    };
  }

  if (!items.every((item) => isBatchEligibleText(item, profile))) {
    return {
      kind: "reply",
      itemCount: items.length,
      outcome: "mixed",
      text: profile.replyStyle.batchMixedMessage
    };
  }

  return { kind: "batch", items };
}

export async function runBatchLookupItems(options: BatchLookupRunOptions & { items: string[] }): Promise<BatchLookupRunResult> {
  const replies: string[] = [];
  const outcomes: string[] = [];
  const traceItems: BatchLookupTraceItem[] = [];

  if (options.items.every(isBatchGuidanceText)) {
    const reply = formatBatchCoachingReply(options.items, options.businessProfile);
    const metadata = metadataForNonLookupKind("lookup_coaching");
    options.metrics?.recordConversationScope(
      options.channel,
      options.businessProfile.tenantId,
      metadata
    );
    return {
      outcomes: ["coaching_batch"],
      replies: [reply],
      traceItems: [
        {
          botReply: reply,
          decision: { batchItems: options.items.length, status: "coaching_batch" },
          inputText: options.items.join("\n"),
          metadata,
          outcome: "coaching_batch"
        }
      ]
    };
  }

  for (const item of options.items) {
    const guidanceKind = batchGuidanceKind(item);
    if (guidanceKind) {
      const reply = guidanceReply(options.businessProfile, guidanceKind);
      const metadata = metadataForNonLookupKind(guidanceKind);
      replies.push(reply);
      outcomes.push(guidanceKind);
      traceItems.push({ botReply: reply, inputText: item, metadata, outcome: guidanceKind });
      options.metrics?.recordConversationScope(options.channel, options.businessProfile.tenantId, metadata);
      continue;
    }

    if (isBatchContextOnlyText(item, options.businessProfile)) {
      const reply = options.businessProfile.replyStyle.batchContextOnlyMessage;
      replies.push(reply);
      outcomes.push("context_only_blocked");
      traceItems.push({
        botReply: reply,
        decision: { status: "context_only_blocked" },
        inputText: item,
        outcome: "context_only_blocked"
      });
      continue;
    }

    const resolved = await resolveTextWithContext({
      businessProfile: options.businessProfile,
      key: "batch:no-context",
      text: item
    });
    if (resolved.kind === "reply") {
      replies.push(resolved.text);
      outcomes.push(resolved.replyPolicy ?? "reply");
      traceItems.push({
        botReply: resolved.text,
        inputText: item,
        metadata: resolved,
        outcome: resolved.replyPolicy ?? "reply"
      });
      options.metrics?.recordConversationScope(options.channel, options.businessProfile.tenantId, resolved);
      continue;
    }

    const result = await runLookupWithTelemetry(
      options.lookup,
      {
        text: resolved.text,
        channel: options.channel,
        chatId: options.chatId,
        userId: options.userId
      },
      {
        logger: options.logger,
        metrics: options.metrics,
        onAssistStart: options.onAssistStart
      }
    );
    await options.onResult?.(result);
    const reply = formatLookupReply(result, options.businessProfile, {
      assistResultFooterEnabled: options.assistResultFooterEnabled,
      assistShowModel: options.assistShowModel,
      capabilityGapShowTechnicalHint: options.capabilityGapShowTechnicalHint
    });
    replies.push(reply);
    outcomes.push(result.status);
    traceItems.push({ botReply: reply, inputText: item, outcome: result.status, result });
  }

  return { outcomes, replies, traceItems };
}

export function prefixBatchReply(index: number, total: number, text: string): string {
  if (total <= 1) return text;
  return `[${index + 1}/${total}] ${text}`;
}

export function isBatchContextOnlyText(text: string, profile: BusinessProfile): boolean {
  const normalized = text.trim();
  if (isBatchGuidanceText(normalized)) return false;
  if (/^[0-9]+$/.test(normalized)) return true;
  if (/^(เพิ่ม|ดูเพิ่ม|ต่อ|next|more)$/i.test(normalized)) return true;
  if (parseIntentOnly(normalized, profile)) return true;
  return detectContextOnlyPhrase(normalized);
}

function isBatchEligibleText(text: string, profile: BusinessProfile): boolean {
  if (isBatchGuidanceText(text)) return true;
  if (isBatchContextOnlyText(text, profile)) return true;
  const nonLookup = classifyNonLookupText(text);
  if (nonLookup) return false;
  if (classifyCapabilityGapText(text, profile)) return true;
  if (parseLookupQuery(text, profile).status === "parsed") return true;
  if (isKnownBareProfileKeyword(text, profile)) return true;
  return containsAny(normalizeText(text), allDomainPhrases(profile));
}

function isBatchGuidanceText(text: string): boolean {
  return batchGuidanceKind(text) != null;
}

function batchGuidanceKind(text: string): "lookup_coaching" | "recommendation_guidance" | undefined {
  const nonLookup = classifyNonLookupText(text);
  if (nonLookup === "lookup_coaching" || nonLookup === "recommendation_guidance") return nonLookup;
  return undefined;
}

function splitBatchItems(text: string): string[] {
  return text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

function detectContextOnlyPhrase(text: string): boolean {
  const normalized = normalizeText(text);
  return [
    "อันที่แล้ว",
    "รายการนี้",
    "ตัวนี้",
    "อันนี้",
    "ชิ้นนี้",
    "รุ่นนี้",
    "แบบถูกสุด",
    "ถูกสุด",
    "แพงสุด",
    "ตัวท็อป",
    "ตัวไหน",
    "อันไหน"
  ].some((marker) => normalized.includes(normalizeText(marker)));
}

function guidanceReply(
  profile: BusinessProfile,
  kind: "lookup_coaching" | "recommendation_guidance"
): string {
  if (kind === "recommendation_guidance") return profile.replyStyle.recommendationGuidanceMessage;
  return profile.replyStyle.lookupCoachingMessage;
}

interface CoachingSuggestion {
  examples: string[];
  note?: string;
  title: string;
}

function formatBatchCoachingReply(items: string[], profile: BusinessProfile): string {
  const suggestions = items.map((item) => buildCoachingSuggestion(item, profile));
  if (suggestions.length === 0) return profile.replyStyle.batchCoachingMessage;

  const lines = [profile.replyStyle.batchCoachingSuggestionIntro, ""];
  for (const [index, suggestion] of suggestions.entries()) {
    lines.push(`${index + 1}. ${suggestion.title}`, ...suggestion.examples);
    if (suggestion.note) lines.push(suggestion.note);
    lines.push("");
  }
  lines.push(profile.replyStyle.batchCoachingSuggestionFooter);
  return lines.join("\n");
}

function buildCoachingSuggestion(text: string, profile: BusinessProfile): CoachingSuggestion {
  const keyword = extractCoachingKeyword(text, profile) ?? `<${profile.replyStyle.entityLabel || "คำค้น"}>`;
  const normalized = normalizeText(text);

  if (/ถ้าหา|ไม่เจอ/u.test(normalized)) {
    return {
      title: `ถ้าหา ${keyword} ไม่เจอ`,
      examples: [`${keyword} ราคา`, `${keyword} มีของไหม`],
      note: `ถ้ายังไม่เจอ ให้ลองค้นด้วยชื่อ รุ่น ยี่ห้อ ขนาด หรือ${profile.replyStyle.entityIdLabel}ที่จำได้`
    };
  }

  if (/ใกล้เคียง|คล้าย|แทน(กัน)?ได้/u.test(normalized)) {
    return {
      title: `ถ้าต้องการ${profile.replyStyle.entityLabel}ใกล้เคียง`,
      examples: [`${keyword} ราคา`, `${keyword} มีของไหม`],
      note: "ถ้าไม่เจอ ให้ลองลดคำค้นเป็นคำหลัก หรือเพิ่มรายละเอียดที่จำได้"
    };
  }

  if (/ถูกสุด|ถูกกว่า|ราคาถูกกว่า|ตัวไหน.*ถูก|อันไหน.*ถูก/u.test(normalized)) {
    return {
      title: `ถ้าต้องการเทียบราคาในกลุ่ม${profile.replyStyle.entityLabel}`,
      examples: [`${keyword} ราคา`],
      note: "หลังระบบแสดงรายการ ให้เลือกเลข 1-5 หรือพิมพ์ \"เพิ่ม\" เพื่อดูรายการต่อไป แล้วค่อยเทียบราคา"
    };
  }

  return {
    title: "ถ้าต้องการตีความคำค้นให้ชัดขึ้น",
    examples: [`${keyword} มีของไหม ราคา`, `${keyword} ราคา`],
    note: `ถ้าต้องการเจาะจงรุ่น ยี่ห้อ หรือขนาด ให้เพิ่มรายละเอียดนั้นหลังชื่อ${profile.replyStyle.entityLabel}`
  };
}

function extractCoachingKeyword(text: string, profile: BusinessProfile): string | undefined {
  const exactCode = text.match(/[A-Z0-9][A-Z0-9_-]{2,}/i)?.[0];
  if (exactCode) return exactCode.toUpperCase();

  const candidates = [
    /กลุ่ม\s*(.+?)(?:\s+ควร|ควรถาม|ถามต่อ|$)/u,
    /ใกล้เคียงกับ\s*(.+?)(?:แต่|ที่|ราคา|ถูกกว่า|บ้าง|ไหม|มั้ย|$)/u,
    /(?:ถ้าหา|หา)\s*(.+?)(?:\s*ไม่เจอ|ช่วย|ควร|$)/u,
    /ลูกค้าถามว่า\s*(.+?)(?:\s*ช่วย|$)/u,
    /(?:ในกลุ่ม|กลุ่ม)\s*(.+?)(?:\s|$)/u
  ];

  for (const pattern of candidates) {
    const candidate = text.match(pattern)?.[1];
    const cleaned = candidate ? cleanCoachingKeyword(candidate, profile) : undefined;
    if (cleaned) return cleaned;
  }

  return undefined;
}

function cleanCoachingKeyword(value: string, profile: BusinessProfile): string | undefined {
  let cleaned = value
    .replace(/[“”"']/g, "")
    .replace(/[?？!！,，.。:：;；()[\]{}<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const removable = [
    ...Object.values(profile.intentPhrases).flat(),
    ...profile.fillerPhrases,
    "เหลือไหม",
    "เหลือมั้ย",
    "มีไหม",
    "มีมั้ย",
    "มีของไหม",
    "มีของมั้ย",
    "ราคาเท่าไหร่",
    "ราคาเท่าไร",
    "ควรถามต่อยังไง",
    "ช่วยตีความคำค้นที่ควรใช้",
    "ช่วยแนะนำว่าควรค้นด้วยคำไหนต่อ"
  ].sort((a, b) => b.length - a.length);

  for (const term of removable) {
    const normalizedTerm = term.trim();
    if (!normalizedTerm) continue;
    cleaned = cleaned.replaceAll(normalizedTerm, " ");
  }

  cleaned = cleaned.replace(/\s+/g, " ").trim();
  return cleaned || undefined;
}

function isKnownBareProfileKeyword(text: string, profile: BusinessProfile): boolean {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  return [
    ...profile.examples.map((example) => example.keyword),
    ...profile.aliases.flatMap((alias) => [alias.from, ...alias.to])
  ].some((term) => {
    const normalizedTerm = normalizeText(term);
    return normalizedTerm && (normalized === normalizedTerm || normalized.includes(normalizedTerm));
  });
}

function containsAny(normalizedInput: string, phrases: string[]): boolean {
  return phrases.some((phrase) => {
    const normalizedPhrase = normalizeText(phrase);
    return normalizedPhrase && normalizedInput.includes(normalizedPhrase);
  });
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function formatTemplate(template: string, values: { maxChars: number; maxItems: number }): string {
  return template.replaceAll("{maxChars}", String(values.maxChars)).replaceAll("{maxItems}", String(values.maxItems));
}
