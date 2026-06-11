import { allDomainPhrases, type BusinessProfile } from "../config/businessProfile.js";
import type { ProductCandidate } from "./types.js";

export type ResultQualityMode = "off" | "warn" | "enforce";

export interface ResultQualityEvaluation {
  acceptedCandidates: ProductCandidate[];
  bestCoverage: number;
  mode: ResultQualityMode;
  reason: "exact_code" | "mode_off" | "no_candidates" | "strong_match" | "weak_coverage";
  status: "accepted" | "needs_refinement" | "warn";
}

export function evaluateResultQuality(options: {
  candidates: ProductCandidate[];
  isExactCode: boolean;
  keyword: string;
  mode: ResultQualityMode;
  profile: BusinessProfile;
  searchTerms: string[];
}): ResultQualityEvaluation {
  if (options.isExactCode) {
    return {
      acceptedCandidates: options.candidates,
      bestCoverage: 1,
      mode: options.mode,
      reason: "exact_code",
      status: "accepted"
    };
  }
  if (options.mode === "off") {
    return {
      acceptedCandidates: options.candidates,
      bestCoverage: 1,
      mode: options.mode,
      reason: "mode_off",
      status: "accepted"
    };
  }
  if (options.candidates.length === 0) {
    return {
      acceptedCandidates: [],
      bestCoverage: 0,
      mode: options.mode,
      reason: "no_candidates",
      status: "accepted"
    };
  }

  const primaryTokens = sanitizeSearchTokens(options.keyword, options.profile);
  const fallbackTerms = options.searchTerms
    .map((term) => sanitizeSearchTokens(term, options.profile))
    .filter((tokens) => tokens.length > 0);
  const acceptedCandidates: ProductCandidate[] = [];
  let bestCoverage = 0;

  for (const candidate of options.candidates) {
    const candidateText = `${candidate.code} ${candidate.name}`;
    const coverage = candidateCoverage(candidateText, primaryTokens, fallbackTerms);
    bestCoverage = Math.max(bestCoverage, coverage);
    if (coverage >= requiredCoverage(primaryTokens)) {
      acceptedCandidates.push(candidate);
    }
  }

  if (acceptedCandidates.length > 0) {
    return {
      acceptedCandidates,
      bestCoverage,
      mode: options.mode,
      reason: "strong_match",
      status: "accepted"
    };
  }

  return {
    acceptedCandidates: options.mode === "warn" ? options.candidates : [],
    bestCoverage,
    mode: options.mode,
    reason: "weak_coverage",
    status: options.mode === "warn" ? "warn" : "needs_refinement"
  };
}

export function sanitizeSearchTokens(text: string, profile: BusinessProfile): string[] {
  const removalPhrases = [
    ...allDomainPhrases(profile),
    ...profile.fillerPhrases,
    profile.replyStyle.entityLabel,
    profile.replyStyle.entityIdLabel,
    "ช่วย",
    "ขอ",
    "กรุณา",
    "please"
  ]
    .map(normalizeText)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  let normalized = normalizeText(text);
  for (const phrase of removalPhrases) {
    normalized = normalized.replace(new RegExp(escapeRegExp(phrase), "giu"), " ");
  }

  return uniqueStrings(
    normalized
      .split(/[^\p{L}\p{M}\p{N}]+/u)
      .map((token) => token.trim())
      .filter((token) => token.length > 0)
  );
}

function candidateCoverage(candidateText: string, primaryTokens: string[], fallbackTerms: string[][]): number {
  if (primaryTokens.length === 0) return 1;
  if (primaryTokens.length === 1) {
    return Math.max(coverage(candidateText, primaryTokens), ...fallbackTerms.map((tokens) => coverage(candidateText, tokens)));
  }
  return coverage(candidateText, primaryTokens);
}

function coverage(candidateText: string, tokens: string[]): number {
  if (tokens.length === 0) return 0;
  const normalizedCandidate = normalizeText(candidateText);
  const matched = tokens.filter((token) => normalizedCandidate.includes(token)).length;
  return matched / tokens.length;
}

function requiredCoverage(primaryTokens: string[]): number {
  if (primaryTokens.length <= 1) return 1;
  if (primaryTokens.length === 2) return 1;
  return 0.8;
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
