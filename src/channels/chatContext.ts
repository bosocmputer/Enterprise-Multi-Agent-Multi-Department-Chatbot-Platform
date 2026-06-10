import { formatBusinessProfileHelp, phraseForIntent, type BusinessProfile } from "../config/businessProfile.js";
import type { LookupIntent, LookupResult, ProductCandidate } from "../core/types.js";
import type { CacheService } from "../services/cacheService.js";

export interface ChatContext {
  candidates?: ProductCandidate[];
  intent?: LookupIntent;
  lastProduct?: ProductCandidate;
}

export type ContextResolution =
  | { kind: "lookup"; text: string }
  | { kind: "reply"; text: string };

export async function resolveTextWithContext(options: {
  businessProfile: BusinessProfile;
  contextStore?: CacheService;
  key: string;
  text: string;
}): Promise<ContextResolution> {
  const normalized = options.text.trim();
  if (isHelpText(normalized)) {
    return { kind: "reply", text: helpText(options.businessProfile) };
  }

  const context = await options.contextStore?.get<ChatContext>(options.key);
  const numericSelection = parseNumericSelection(normalized);
  if (numericSelection != null) {
    if (!context?.candidates?.length) {
      return {
        kind: "reply",
        text: "รายการที่ให้เลือกหมดอายุแล้ว กรุณาค้นหาสินค้าใหม่อีกครั้ง"
      };
    }
    if (!context.candidates[numericSelection]) {
      return {
        kind: "reply",
        text: `กรุณาเลือกเลข 1-${context.candidates.length} หรือส่งรหัสสินค้า`
      };
    }
    return {
      kind: "lookup",
      text: `${context.candidates[numericSelection].code} ${intentPrompt(context.intent, options.businessProfile)}`
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
        text: "ยังไม่รู้ว่าสินค้าตัวไหน กรุณาส่งรหัสสินค้า หรือค้นหาสินค้าก่อน"
      };
    }
    return { kind: "lookup", text: `${context.lastProduct.code} ${intentPrompt(intentOnly, options.businessProfile)}` };
  }

  if (context?.intent) {
    return { kind: "lookup", text: `${normalized} ${intentPrompt(context.intent, options.businessProfile)}` };
  }

  if (isKnownBareProductKeyword(normalized, options.businessProfile)) {
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
        candidates: options.result.candidates.slice(0, 5),
        intent: normalizeContextIntent(options.result.intent)
      },
      options.ttlSeconds
    );
    return;
  }

  if (options.result.status === "success") {
    await options.contextStore.set<ChatContext>(
      options.key,
      {
        intent: normalizeContextIntent(options.result.intent),
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
  const wantsStock = ["stock", "stocks", ...profile.intentPhrases.stock].some(
    (term) => term.trim().toLowerCase() === normalized
  );
  const wantsPrice = ["price", ...profile.intentPhrases.price].some((term) => term.trim().toLowerCase() === normalized);
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
      return {
        kind: "reply",
        text: `ตอนนี้ยังเลือกสินค้าจากคำว่า "${options.marker}" อัตโนมัติไม่ได้ กรุณาเลือกเลข 1-${options.context.candidates.length} จากรายการล่าสุด หรือส่งรหัสสินค้า`
      };
    }
    return {
      kind: "reply",
      text: `ตอนนี้ยังเลือกสินค้าจากคำว่า "${options.marker}" ไม่ได้ กรุณาส่งชื่อสินค้า รุ่น ยี่ห้อ หรือรหัสสินค้าให้ชัดเจนขึ้น`
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
    return {
      kind: "reply",
      text: `ยังไม่รู้ว่า "${options.marker}" คือรายการไหน กรุณาเลือกเลข 1-${options.context.candidates.length} จากรายการล่าสุด หรือส่งรหัสสินค้า`
    };
  }
  return {
    kind: "reply",
    text: "ยังไม่รู้ว่าสินค้าตัวไหน กรุณาส่งรหัสสินค้า ชื่อสินค้า หรือค้นหาสินค้าก่อน"
  };
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
  const hasStockPrice = containsAny(normalized, profile.intentPhrases.stock_price);
  const hasStock = containsAny(normalized, profile.intentPhrases.stock);
  const hasPrice = containsAny(normalized, profile.intentPhrases.price);
  if (hasStockPrice || (hasStock && hasPrice)) return "stock_price";
  if (hasPrice) return "price";
  if (hasStock) return "stock";
  return undefined;
}

function isKnownBareProductKeyword(text: string, profile: BusinessProfile): boolean {
  const normalized = normalizeText(text);
  if (!normalized || parseIntentFromText(normalized, profile)) return false;

  return knownProductTerms(profile).some((term) => {
    const normalizedTerm = normalizeText(term);
    return normalizedTerm && (normalized === normalizedTerm || normalized.includes(normalizedTerm));
  });
}

function knownProductTerms(profile: BusinessProfile): string[] {
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
