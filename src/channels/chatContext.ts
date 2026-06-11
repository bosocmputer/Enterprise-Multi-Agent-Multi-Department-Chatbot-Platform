import {
  formatBusinessProfileHelp,
  phraseForIntent,
  phrasesForLegacyIntent,
  type BusinessProfile
} from "../config/businessProfile.js";
import { classifyNonLookupText, type NonLookupKind } from "../core/nonLookupGuard.js";
import { formatMultipleMatches } from "../core/responseFormatter.js";
import type { EntityCandidate, LookupActionId, LookupIntent, LookupResult, ProductCandidate } from "../core/types.js";
import type { CacheService } from "../services/cacheService.js";

export interface ChatContext {
  action?: LookupActionId;
  candidatePageStart?: number;
  candidates?: ProductCandidate[];
  entities?: EntityCandidate[];
  entityType?: string;
  intent?: LookupIntent;
  keyword?: string;
  lastEntity?: EntityCandidate;
  lastProduct?: ProductCandidate;
  pageSize?: number;
  totalFound?: number;
}

export type ContextResolution =
  | { kind: "lookup"; text: string }
  | { kind: "reply"; text: string };

export async function resolveTextWithContext(options: {
  businessProfile: BusinessProfile;
  contextStore?: CacheService;
  contextTtlSeconds?: number;
  key: string;
  text: string;
}): Promise<ContextResolution> {
  const normalized = options.text.trim();
  if (isHelpText(normalized)) {
    return { kind: "reply", text: helpText(options.businessProfile) };
  }
  const nonLookup = classifyNonLookupText(normalized);
  if (nonLookup && !parseIntentFromText(normalized, options.businessProfile) && !parseExactCode(normalized)) {
    return { kind: "reply", text: nonLookupReply(options.businessProfile, nonLookup) };
  }

  const context = await options.contextStore?.get<ChatContext>(options.key);
  if (isMoreResultsText(normalized)) {
    return resolveMoreResults({
      businessProfile: options.businessProfile,
      context,
      contextStore: options.contextStore,
      key: options.key,
      ttlSeconds: options.contextTtlSeconds ?? 300
    });
  }

  const numericSelection = parseNumericSelection(normalized);
  if (numericSelection != null) {
    if (!context?.candidates?.length) {
      return {
        kind: "reply",
        text: options.businessProfile.replyStyle.noContextPrompt
      };
    }
    const pageStart = context.candidatePageStart ?? 0;
    const pageSize = context.pageSize ?? 5;
    const visibleCount = Math.min(pageSize, Math.max(0, context.candidates.length - pageStart));
    if (numericSelection < 0 || numericSelection >= visibleCount) {
      const keyword = context.keyword ? ` สำหรับ "${context.keyword}"` : "";
      return {
        kind: "reply",
        text: `กรุณาเลือกเลข 1-${visibleCount || 1}${keyword} หรือส่ง${options.businessProfile.replyStyle.entityIdLabel}`
      };
    }
    const selected = context.candidates[pageStart + numericSelection];
    if (!selected) {
      return { kind: "reply", text: options.businessProfile.replyStyle.noContextPrompt };
    }
    return {
      kind: "lookup",
      text: `${selected.code} ${intentPrompt(context.intent, options.businessProfile)}`
    };
  }

  const exactCode = parseExactCode(normalized);
  if (exactCode && context?.intent) {
    return { kind: "lookup", text: `${exactCode} ${intentPrompt(context.intent, options.businessProfile)}` };
  }

  const contextRequiredPhrase = detectContextRequiredPhrase(normalized);
  if (contextRequiredPhrase) {
    return resolveContextRequiredPhrase({
      businessProfile: options.businessProfile,
      context,
      marker: contextRequiredPhrase.marker,
      text: normalized,
      type: contextRequiredPhrase.type
    });
  }

  const intentOnly = parseIntentOnly(normalized, options.businessProfile);
  if (intentOnly) {
    if (!context?.lastProduct) {
      return {
        kind: "reply",
        text: options.businessProfile.replyStyle.noContextPrompt
      };
    }
    return { kind: "lookup", text: `${context.lastProduct.code} ${intentPrompt(intentOnly, options.businessProfile)}` };
  }

  if (parseIntentFromText(normalized, options.businessProfile)) {
    return { kind: "lookup", text: normalized };
  }

  if (context?.intent) {
    return { kind: "lookup", text: `${normalized} ${intentPrompt(context.intent, options.businessProfile)}` };
  }

  if (isKnownBareProfileKeyword(normalized, options.businessProfile)) {
    return { kind: "lookup", text: `${normalized} ${phraseForIntent(options.businessProfile, "search_product")}` };
  }

  return { kind: "lookup", text: normalized };
}

export async function saveLookupContext(options: {
  contextStore?: CacheService;
  key: string;
  result: LookupResult;
  ttlSeconds: number;
}): Promise<void> {
  if (!options.contextStore) return;

  if (options.result.status === "multiple_matches") {
    await options.contextStore.set<ChatContext>(
      options.key,
      {
        action: options.result.action,
        candidatePageStart: options.result.pageStart ?? 0,
        candidates: options.result.candidates,
        entities: options.result.entities,
        entityType: options.result.entityType,
        intent: normalizeContextIntent(options.result.intent),
        keyword: options.result.keyword,
        pageSize: options.result.pageSize ?? 5,
        totalFound: options.result.totalFound
      },
      options.ttlSeconds
    );
    return;
  }

  if (options.result.status === "success") {
    await options.contextStore.set<ChatContext>(
      options.key,
      {
        action: options.result.action,
        entityType: options.result.entityType,
        intent: normalizeContextIntent(options.result.intent),
        lastEntity: options.result.entity,
        lastProduct: options.result.product
      },
      options.ttlSeconds
    );
  }
}

export function helpText(profile: BusinessProfile): string {
  return formatBusinessProfileHelp(profile);
}

export function isHelpText(text: string): boolean {
  return /^(\/start|\/help|help|ช่วยเหลือ|วิธีใช้)$/i.test(text.trim());
}

export function parseIntentOnly(text: string, profile: BusinessProfile): LookupIntent | undefined {
  const normalized = text.trim().toLowerCase();
  const wantsStock = ["stock", "stocks", ...phrasesForLegacyIntent(profile, "stock")].some(
    (term) => term.trim().toLowerCase() === normalized
  );
  const wantsPrice = ["price", ...phrasesForLegacyIntent(profile, "price")].some(
    (term) => term.trim().toLowerCase() === normalized
  );
  if (wantsStock && wantsPrice) return "stock_price";
  if (wantsStock) return "stock";
  if (wantsPrice) return "price";
  return undefined;
}

export function intentPrompt(intent: LookupIntent | undefined, profile: BusinessProfile): string {
  switch (normalizeContextIntent(intent ?? "stock_price")) {
    case "price":
      return phraseForIntent(profile, "price");
    case "stock":
      return phraseForIntent(profile, "stock");
    case "stock_price":
      return `${phraseForIntent(profile, "stock")} ${phraseForIntent(profile, "price")}`;
    case "search_product":
      return `${phraseForIntent(profile, "stock")} ${phraseForIntent(profile, "price")}`;
  }
}

export function normalizeContextIntent(intent: LookupIntent): LookupIntent {
  return intent === "search_product" ? "stock_price" : intent;
}

function parseNumericSelection(text: string): number | undefined {
  const match = text.match(/^\s*([0-9]+)\s*$/);
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isInteger(value) ? value - 1 : undefined;
}

function isMoreResultsText(text: string): boolean {
  return /^(เพิ่ม|ดูเพิ่ม|ต่อ|next|more)$/i.test(text.trim());
}

async function resolveMoreResults(options: {
  businessProfile: BusinessProfile;
  context?: ChatContext;
  contextStore?: CacheService;
  key: string;
  ttlSeconds: number;
}): Promise<ContextResolution> {
  if (!options.context?.candidates?.length) {
    return { kind: "reply", text: options.businessProfile.replyStyle.noContextPrompt };
  }

  const pageSize = options.context.pageSize ?? 5;
  const currentStart = options.context.candidatePageStart ?? 0;
  const nextStart = currentStart + pageSize;
  if (nextStart >= options.context.candidates.length) {
    const totalFound = options.context.totalFound ?? options.context.candidates.length;
    return {
      kind: "reply",
      text:
        totalFound > options.context.candidates.length
          ? options.businessProfile.replyStyle.refineMoreResultsPrompt
          : options.businessProfile.replyStyle.noMoreResultsPrompt
    };
  }

  const updatedContext: ChatContext = {
    ...options.context,
    candidatePageStart: nextStart,
    pageSize
  };
  await options.contextStore?.set(options.key, updatedContext, options.ttlSeconds);

  return {
    kind: "reply",
    text: formatMultipleMatches({
      candidates: updatedContext.candidates ?? [],
      hasMore:
        nextStart + pageSize < (updatedContext.candidates?.length ?? 0) ||
        nextStart + pageSize < (updatedContext.totalFound ?? updatedContext.candidates?.length ?? 0),
      intent: updatedContext.intent ?? "stock_price",
      keyword: updatedContext.keyword ?? "รายการล่าสุด",
      pageSize,
      pageStart: nextStart,
      profile: options.businessProfile,
      totalFound: updatedContext.totalFound
    })
  };
}

function parseExactCode(text: string): string | undefined {
  const normalized = text.trim();
  return /^[A-Z0-9][A-Z0-9_-]{2,}$/i.test(normalized) ? normalized : undefined;
}

function resolveContextRequiredPhrase(options: {
  businessProfile: BusinessProfile;
  context?: ChatContext;
  marker: string;
  text: string;
  type: "product_reference" | "selection_constraint";
}): ContextResolution {
  if (options.type === "selection_constraint") {
    if (options.context?.candidates?.length) {
      const visibleCount = visibleCandidateCount(options.context);
      return {
        kind: "reply",
        text: `ตอนนี้ยังเลือก${options.businessProfile.replyStyle.entityLabel}จากคำว่า "${options.marker}" อัตโนมัติไม่ได้ กรุณาเลือกเลข 1-${visibleCount} จากรายการล่าสุด หรือส่ง${options.businessProfile.replyStyle.entityIdLabel}`
      };
    }
    return {
      kind: "reply",
      text: `ตอนนี้ยังเลือก${options.businessProfile.replyStyle.entityLabel}จากคำว่า "${options.marker}" ไม่ได้ กรุณาส่งรายละเอียดหรือ${options.businessProfile.replyStyle.entityIdLabel}ให้ชัดเจนขึ้น`
    };
  }

  const requestedIntent = parseIntentFromText(options.text, options.businessProfile) ?? options.context?.intent;
  if (options.context?.lastProduct) {
    return {
      kind: "lookup",
      text: `${options.context.lastProduct.code} ${intentPrompt(requestedIntent, options.businessProfile)}`
    };
  }
  if (options.context?.candidates?.length) {
    const visibleCount = visibleCandidateCount(options.context);
    return {
      kind: "reply",
      text: `ยังไม่รู้ว่า "${options.marker}" คือรายการไหน กรุณาเลือกเลข 1-${visibleCount} จากรายการล่าสุด หรือส่ง${options.businessProfile.replyStyle.entityIdLabel}`
    };
  }
  return {
    kind: "reply",
    text: options.businessProfile.replyStyle.noContextPrompt
  };
}

function visibleCandidateCount(context: ChatContext): number {
  const pageStart = context.candidatePageStart ?? 0;
  const pageSize = context.pageSize ?? 5;
  return Math.min(pageSize, Math.max(0, (context.candidates?.length ?? 0) - pageStart));
}

function detectContextRequiredPhrase(
  text: string
): { marker: string; type: "product_reference" | "selection_constraint" } | undefined {
  const normalized = normalizeText(text);
  const productReferences = ["อันที่แล้ว", "รายการนี้", "ตัวนี้", "อันนี้", "ชิ้นนี้", "รุ่นนี้"];
  const selectionConstraints = ["แบบถูกสุด", "ถูกสุด", "แพงสุด", "ตัวท็อป", "ตัวไหน", "อันไหน"];

  for (const marker of [...productReferences].sort((a, b) => b.length - a.length)) {
    if (normalized.includes(normalizeText(marker))) return { marker, type: "product_reference" };
  }
  for (const marker of [...selectionConstraints].sort((a, b) => b.length - a.length)) {
    if (normalized.includes(normalizeText(marker))) return { marker, type: "selection_constraint" };
  }
  return undefined;
}

function parseIntentFromText(text: string, profile: BusinessProfile): LookupIntent | undefined {
  const normalized = normalizeText(text);
  const hasStockPrice = containsAny(normalized, phrasesForLegacyIntent(profile, "stock_price"));
  const hasStock = containsAny(normalized, phrasesForLegacyIntent(profile, "stock"));
  const hasPrice = containsAny(normalized, phrasesForLegacyIntent(profile, "price"));
  if (hasStockPrice || (hasStock && hasPrice)) return "stock_price";
  if (hasPrice) return "price";
  if (hasStock) return "stock";
  return undefined;
}

function isKnownBareProfileKeyword(text: string, profile: BusinessProfile): boolean {
  const normalized = normalizeText(text);
  if (!normalized || parseIntentFromText(normalized, profile)) return false;

  return knownProfileTerms(profile).some((term) => {
    const normalizedTerm = normalizeText(term);
    return normalizedTerm && (normalized === normalizedTerm || normalized.includes(normalizedTerm));
  });
}

function knownProfileTerms(profile: BusinessProfile): string[] {
  return [
    ...profile.examples.map((example) => example.keyword),
    ...profile.aliases.flatMap((alias) => [alias.from, ...alias.to])
  ];
}

function containsAny(normalizedInput: string, phrases: string[]): boolean {
  return phrases.some((term) => {
    const normalizedTerm = normalizeText(term);
    return normalizedTerm && normalizedInput.includes(normalizedTerm);
  });
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function nonLookupReply(profile: BusinessProfile, kind: NonLookupKind): string {
  if (kind === "help_question") return helpText(profile);
  if (kind === "greeting" || kind === "thanks" || kind === "acknowledgement") {
    return profile.replyStyle.greetingMessage;
  }
  return profile.replyStyle.unsupportedMessage;
}
