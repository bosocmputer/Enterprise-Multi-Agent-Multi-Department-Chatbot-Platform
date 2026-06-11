import type { ConversationMetadata, ConversationScope, OutOfScopeCategory, ReplyPolicy } from "./types.js";

export type NonLookupKind =
  | "acknowledgement"
  | "empty"
  | "emoji_only"
  | "greeting"
  | "help_question"
  | "out_of_scope_current_info"
  | "out_of_scope_general"
  | "thanks";

const friendlyReasonPrefix = "friendly_";

export function classifyNonLookupText(text: string): NonLookupKind | undefined {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized) return "empty";

  if (!/[\p{L}\p{N}]/u.test(normalized)) return "emoji_only";

  const compact = stripPoliteSuffix(normalized);
  if (isOutOfScopeCurrentInfo(compact)) return "out_of_scope_current_info";
  if (isOutOfScopeGeneral(compact)) return "out_of_scope_general";
  if (isHelpQuestion(compact)) return "help_question";
  if (isGreeting(compact)) return "greeting";
  if (isThanks(compact)) return "thanks";
  if (isAcknowledgement(compact)) return "acknowledgement";

  return undefined;
}

export function friendlyUnsupportedReason(kind: NonLookupKind): string {
  if (isOutOfScopeKind(kind)) return kind;
  return `${friendlyReasonPrefix}${kind}`;
}

export function nonLookupKindFromReason(reason: string): NonLookupKind | undefined {
  if (isNonLookupKind(reason)) return reason;
  if (!reason.startsWith(friendlyReasonPrefix)) return undefined;
  const kind = reason.slice(friendlyReasonPrefix.length);
  return isNonLookupKind(kind) ? kind : undefined;
}

export function isOutOfScopeKind(
  kind: NonLookupKind | undefined
): kind is "out_of_scope_current_info" | "out_of_scope_general" {
  return kind === "out_of_scope_current_info" || kind === "out_of_scope_general";
}

export function metadataForNonLookupKind(kind: NonLookupKind): ConversationMetadata {
  return {
    conversationScope: conversationScopeForKind(kind),
    outOfScopeCategory: outOfScopeCategoryForKind(kind),
    parserPath: "none",
    replyPolicy: replyPolicyForKind(kind)
  };
}

export function conversationScopeForKind(kind: NonLookupKind): ConversationScope {
  if (kind === "help_question") return "help";
  if (kind === "out_of_scope_current_info") return "out_of_scope_current_info";
  if (kind === "out_of_scope_general") return "out_of_scope_general";
  return "friendly";
}

export function outOfScopeCategoryForKind(kind: NonLookupKind): OutOfScopeCategory {
  if (kind === "out_of_scope_current_info") return "current_info";
  if (kind === "out_of_scope_general") return "general";
  return "none";
}

export function replyPolicyForKind(kind: NonLookupKind): ReplyPolicy {
  if (kind === "help_question") return "help";
  if (isOutOfScopeKind(kind)) return "refuse_redirect";
  return "friendly";
}

function isHelpQuestion(text: string): boolean {
  return [
    "ช่วยใช้งานยังไง",
    "ใช้งานยังไง",
    "วิธีใช้งาน",
    "วิธีใช้",
    "ทำอะไรได้บ้าง",
    "ใช้ยังไง",
    "help",
    "how to use"
  ].includes(text);
}

function isOutOfScopeCurrentInfo(text: string): boolean {
  return [
    /อากาศ/u,
    /พยากรณ์/u,
    /ฝนตก/u,
    /ข่าว/u,
    /หวย/u,
    /เลขเด็ด/u,
    /ราคาทอง/u,
    /ทองคำ/u,
    /ค่าเงิน/u,
    /อัตราแลกเปลี่ยน/u,
    /กี่โมง/u,
    /เวลา.*ตอนนี้/u,
    /weather/i,
    /forecast/i,
    /rain/i,
    /news/i,
    /lottery/i,
    /gold price/i,
    /exchange rate/i,
    /current time/i
  ].some((pattern) => pattern.test(text));
}

function isOutOfScopeGeneral(text: string): boolean {
  return [
    /กินอะไรดี/u,
    /ทำอาหาร/u,
    /สูตรอาหาร/u,
    /เล่าเรื่องตลก/u,
    /นิทาน/u,
    /ร้องเพลง/u,
    /เล่นเกม/u,
    /ดูดวง/u,
    /ความรัก/u,
    /คุยเล่น/u,
    /joke/i,
    /recipe/i,
    /cook/i,
    /sing/i,
    /game/i,
    /horoscope/i
  ].some((pattern) => pattern.test(text));
}

function isGreeting(text: string): boolean {
  if (["hello", "hi", "hey", "สวัสดี", "หวัดดี", "ดีครับ", "ดีค่ะ"].includes(text)) return true;
  return /^(สวัสดี|หวัดดี)(ครับ|ค่ะ|คะ)?$/.test(text);
}

function isThanks(text: string): boolean {
  if (["thanks", "thank you", "thx", "ขอบคุณ", "ขอบใจ"].includes(text)) return true;
  return /^(ขอบคุณ|ขอบใจ)(ครับ|ค่ะ|คะ)?$/.test(text);
}

function isAcknowledgement(text: string): boolean {
  return ["ok", "okay", "โอเค", "โอเคครับ", "โอเคค่ะ", "รับทราบ", "ได้ครับ", "ได้ค่ะ"].includes(text);
}

function stripPoliteSuffix(text: string): string {
  return text.replace(/\s+(ครับ|ค่ะ|คะ|จ้า)$/u, "").trim();
}

function isNonLookupKind(value: string): value is NonLookupKind {
  return [
    "acknowledgement",
    "empty",
    "emoji_only",
    "greeting",
    "help_question",
    "out_of_scope_current_info",
    "out_of_scope_general",
    "thanks"
  ].includes(value);
}
