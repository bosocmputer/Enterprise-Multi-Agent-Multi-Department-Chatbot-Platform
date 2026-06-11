import {
  requestableCapabilities,
  type BusinessProfile,
  type RequestableCapabilityProfile
} from "../config/businessProfile.js";
import type { CapabilityGapDetails } from "./types.js";

export function classifyCapabilityGapText(text: string, profile: BusinessProfile): CapabilityGapDetails | undefined {
  const normalized = normalizeText(text);
  if (!normalized) return undefined;

  for (const capability of requestableCapabilities(profile)) {
    const matched = capability.phrases.some((phrase) => {
      const normalizedPhrase = normalizeText(phrase);
      return normalizedPhrase.length > 0 && normalized.includes(normalizedPhrase);
    });
    if (matched) return capabilityGapDetails(capability, "profile");
  }

  return undefined;
}

export function capabilityGapDetailsForId(
  id: string | undefined,
  profile: BusinessProfile,
  source: "llm" | "profile"
): CapabilityGapDetails | undefined {
  if (!id) return undefined;
  const normalizedId = id.trim();
  const capability = requestableCapabilities(profile).find((item) => item.id === normalizedId);
  return capability ? capabilityGapDetails(capability, source) : undefined;
}

function capabilityGapDetails(
  capability: RequestableCapabilityProfile,
  source: "llm" | "profile"
): CapabilityGapDetails {
  return {
    capabilityId: capability.id,
    capabilityLabel: capability.label,
    entityType: capability.entityTypes[0],
    requiredFields: capability.requiredFields,
    source,
    suggestedReadOnlyTool: capability.suggestedReadOnlyTool
  };
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}
