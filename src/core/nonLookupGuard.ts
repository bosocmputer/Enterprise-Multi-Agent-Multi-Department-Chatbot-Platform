export type NonLookupKind =
  | "acknowledgement"
  | "empty"
  | "emoji_only"
  | "greeting"
  | "help_question"
  | "thanks";

const reasonPrefix = "friendly_";

export function classifyNonLookupText(text: string): NonLookupKind | undefined {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized) return "empty";

  if (!/[\p{L}\p{N}]/u.test(normalized)) return "emoji_only";

  const compact = stripPoliteSuffix(normalized);
  if (isHelpQuestion(compact)) return "help_question";
  if (isGreeting(compact)) return "greeting";
  if (isThanks(compact)) return "thanks";
  if (isAcknowledgement(compact)) return "acknowledgement";

  return undefined;
}

export function friendlyUnsupportedReason(kind: NonLookupKind): string {
  return `${reasonPrefix}${kind}`;
}

export function nonLookupKindFromReason(reason: string): NonLookupKind | undefined {
  if (!reason.startsWith(reasonPrefix)) return undefined;
  const kind = reason.slice(reasonPrefix.length);
  return isNonLookupKind(kind) ? kind : undefined;
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
  return ["acknowledgement", "empty", "emoji_only", "greeting", "help_question", "thanks"].includes(value);
}
