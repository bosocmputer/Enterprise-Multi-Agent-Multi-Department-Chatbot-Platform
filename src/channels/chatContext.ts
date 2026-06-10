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
