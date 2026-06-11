import {
  actionForLegacyIntent,
  allDomainPhrases,
  commandAliasesForLegacyIntents,
  defaultEntityType,
  phrasesForLegacyIntent,
  type BusinessProfile
} from "../config/businessProfile.js";
import type { LookupIntent, ParseOutcome } from "./types.js";

const exactCodePattern = /^[A-Z0-9][A-Z0-9_-]{2,}$/i;

export function parseLookupQuery(input: string, profile: BusinessProfile): ParseOutcome {
  const original = input.trim();
  if (!original) {
    return { status: "unsupported", reason: "empty_message" };
  }

  const withoutMentions = original.replace(/@\S+/g, " ");
  const commandPattern = commandPatternForProfile(profile);
  const commandMatch = commandPattern ? withoutMentions.match(commandPattern) : undefined;
  const command = commandMatch?.[1]?.toLowerCase();
  const commandIntent = command
    ? commandAliasesForLegacyIntents(profile).find((item) => item.command === command)?.intent
    : undefined;

  let working = (commandPattern ? withoutMentions.replace(commandPattern, " ") : withoutMentions).replace(/\s+/g, " ").trim();

  const patternParsed = commandIntent ? undefined : parseProfilePattern(working, profile);
  if (patternParsed) return patternParsed;

  const lower = working.toLowerCase();
  const hasStockPrice = containsAny(lower, phrasesForLegacyIntent(profile, "stock_price"));
  const hasStock = commandIntent === "stock" || containsAny(lower, phrasesForLegacyIntent(profile, "stock"));
  const hasPrice = commandIntent === "price" || containsAny(lower, phrasesForLegacyIntent(profile, "price"));
  const hasSearch =
    commandIntent === "search_product" || containsAny(lower, phrasesForLegacyIntent(profile, "search_product"));

  let intent: LookupIntent | undefined = commandIntent;
  if (!intent) {
    if (hasStockPrice || (hasStock && hasPrice)) intent = "stock_price";
    else if (hasStock) intent = "stock";
    else if (hasPrice) intent = "price";
    else if (hasSearch) intent = "search_product";
  }

  const firstToken = working.split(/\s+/)[0] ?? "";
  const isExactCodeCandidate = exactCodePattern.test(firstToken);
  if (!intent && isExactCodeCandidate) {
    intent = firstEnabledIntent(profile, ["stock_price", "stock", "price", "search_product"]);
  }

  if (!intent) {
    return { status: "unsupported", reason: "intent_not_found" };
  }
  if (!profile.enabledIntents.includes(intent)) {
    return { status: "unsupported", reason: "intent_disabled" };
  }

  for (const term of phrasesForRemoval(profile)) {
    working = working.replace(new RegExp(escapeRegExp(term), "gi"), " ");
  }

  const keyword = working.replace(/\s+/g, " ").trim();
  if (!keyword) {
    return { status: "unsupported", reason: "keyword_not_found" };
  }

  return parsedOutcome(intent, keyword, profile);
}

function parseProfilePattern(input: string, profile: BusinessProfile): ParseOutcome | undefined {
  for (const item of profile.intentPatterns) {
    if (!profile.enabledIntents.includes(item.intent)) continue;
    const match = input.match(new RegExp(item.pattern, "iu"));
    const keyword = match?.groups?.[item.keywordGroup]?.trim();
    if (!keyword) continue;
    return parsedOutcome(item.intent, keyword, profile);
  }
  return undefined;
}

function parsedOutcome(intent: LookupIntent, keyword: string, profile: BusinessProfile): Extract<ParseOutcome, { status: "parsed" }> {
  const action = actionForLegacyIntent(profile, intent);
  return {
    status: "parsed",
    action: action?.id,
    entityType: action?.entityTypes[0] ?? defaultEntityType(profile),
    intent,
    keyword,
    isExactCode: exactCodePattern.test(keyword),
    query: keyword,
    searchTerms: expandSearchTerms(keyword, profile)
  };
}

function expandSearchTerms(keyword: string, profile: BusinessProfile): string[] {
  const terms = new Set<string>([keyword]);
  const normalizedKeyword = normalizeText(keyword);

  for (const alias of profile.aliases) {
    const normalizedFrom = normalizeText(alias.from);
    if (!normalizedFrom || !normalizedKeyword.includes(normalizedFrom)) continue;

    for (const target of alias.to) {
      terms.add(target);
      if (normalizedKeyword === normalizedFrom) continue;
      terms.add(keyword.replace(new RegExp(escapeRegExp(alias.from), "gi"), target).replace(/\s+/g, " ").trim());
    }
  }

  return [...terms].filter(Boolean);
}

function containsAny(lowerInput: string, phrases: string[]): boolean {
  return phrases.some((term) => lowerInput.includes(term.toLowerCase()));
}

function firstEnabledIntent(profile: BusinessProfile, intents: LookupIntent[]): LookupIntent | undefined {
  return intents.find((intent) => profile.enabledIntents.includes(intent));
}

function phrasesForRemoval(profile: BusinessProfile): string[] {
  return [
    ...allDomainPhrases(profile),
    ...profile.fillerPhrases
  ]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
}

function commandPatternForProfile(profile: BusinessProfile): RegExp | undefined {
  const commands = commandAliasesForLegacyIntents(profile)
    .map((item) => item.command)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  if (commands.length === 0) return undefined;
  return new RegExp(`^\\/(${commands.map(escapeRegExp).join("|")})(?:@\\S+)?\\b`, "i");
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
