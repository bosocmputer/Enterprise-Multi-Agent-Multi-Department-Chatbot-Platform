import type { BusinessProfile } from "../config/businessProfile.js";
import type { LlmAssistInfo, LlmAssistStartEvent } from "./types.js";

export interface AssistFormatOptions {
  showModel?: boolean;
}

export function formatAssistStartingMessage(
  profile: BusinessProfile,
  event: LlmAssistStartEvent,
  options: AssistFormatOptions = {}
): string {
  return formatTemplate(profile.replyStyle.assistStartingMessage, placeholders(profile, event, options));
}

export function formatAssistSuccessFooter(
  profile: BusinessProfile,
  assist: LlmAssistInfo,
  options: AssistFormatOptions = {}
): string {
  return formatTemplate(profile.replyStyle.assistSuccessFooter, placeholders(profile, assist, options));
}

export function formatAssistFailureMessage(
  profile: BusinessProfile,
  assist: LlmAssistInfo,
  options: AssistFormatOptions = {}
): string {
  return formatTemplate(profile.replyStyle.assistFailureMessage, placeholders(profile, assist, options));
}

function placeholders(
  profile: BusinessProfile,
  assist: LlmAssistInfo | LlmAssistStartEvent,
  options: AssistFormatOptions
): Record<string, string> {
  return {
    durationMs: "durationMs" in assist && assist.durationMs != null ? String(assist.durationMs) : "-",
    model: options.showModel === false ? "ไม่แสดง" : assist.model,
    outcome: "outcome" in assist && assist.outcome ? assist.outcome : "started",
    provider: assist.provider,
    sourceTruthFooter: profile.replyStyle.sourceTruthFooter,
    timeoutMs: String(assist.timeoutMs)
  };
}

function formatTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key: string) => values[key] ?? "");
}
