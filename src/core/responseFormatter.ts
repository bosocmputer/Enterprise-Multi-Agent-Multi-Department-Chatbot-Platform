import { formatBusinessProfileHelp, type BusinessProfile } from "../config/businessProfile.js";
import { formatAssistFailureMessage, formatAssistSuccessFooter } from "./assistFormatting.js";
import { entityDisplayId, entityDisplayLabel } from "./entityAdapter.js";
import { nonLookupKindFromReason } from "./nonLookupGuard.js";
import type { LookupIntent, LookupResult, PriceLine, ProductCandidate, StockLine } from "./types.js";

const DEFAULT_PAGE_SIZE = 5;

export interface LookupReplyFormatOptions {
  assistResultFooterEnabled?: boolean;
  assistShowModel?: boolean;
}

export function formatLookupReply(
  result: LookupResult,
  profile?: BusinessProfile,
  options: LookupReplyFormatOptions = {}
): string {
  if (profile && result.assist?.status === "rejected") {
    return formatAssistFailureMessage(profile, result.assist, { showModel: options.assistShowModel });
  }

  let reply: string;
  switch (result.status) {
    case "success":
      reply = formatSuccess(result);
      break;
    case "no_match":
      reply = [
        `ไม่พบ${profile?.replyStyle.entityLabel ?? "รายการ"}ที่ตรงกับ "${result.keyword}"`,
        profile?.replyStyle.fallbackProductHints ?? "ลองส่งรหัส รายละเอียด หรือคำค้นที่เฉพาะเจาะจงขึ้น"
      ].join("\n");
      break;
    case "multiple_matches":
      if (result.candidates.length === 0) {
        reply = `ไม่พบตัวเลือก${profile?.replyStyle.entityLabel ?? "รายการ"}ที่ชัดเจนจาก "${result.keyword}"`;
        break;
      }
      reply = formatMultipleMatches({
        candidates: result.candidates,
        hasMore: result.hasMore,
        intent: result.intent,
        keyword: result.keyword,
        pageSize: result.pageSize,
        pageStart: result.pageStart,
        profile,
        totalFound: result.totalFound
      });
      break;
    case "unsupported":
      reply = formatUnsupportedReply(result.reason, profile);
      break;
    case "dependency_error":
      if (result.reason === "sml_timeout") {
        reply = "ระบบต้นทางตอบช้าเกินไป กรุณาลองใหม่อีกครั้ง";
        break;
      }
      if (result.reason === "sml_circuit_open") {
        reply = "ระบบต้นทางมีปัญหาชั่วคราว กรุณาลองใหม่อีกครั้ง";
        break;
      }
      reply = `ตอนนี้ดึงข้อมูล${profile?.replyStyle.entityLabel ?? ""}ไม่ได้ กรุณาลองใหม่อีกครั้ง`;
      break;
  }

  if (profile && options.assistResultFooterEnabled !== false && result.assist?.status === "parsed") {
    return [reply, "", formatAssistSuccessFooter(profile, result.assist, { showModel: options.assistShowModel })].join("\n");
  }
  return reply;
}

export function formatMultipleMatches(options: {
  candidates: ProductCandidate[];
  hasMore?: boolean;
  intent: LookupIntent;
  keyword: string;
  pageSize?: number;
  pageStart?: number;
  profile?: BusinessProfile;
  totalFound?: number;
}): string {
  const pageSize = Math.max(1, options.pageSize ?? DEFAULT_PAGE_SIZE);
  const pageStart = Math.max(0, options.pageStart ?? 0);
  const visible = options.candidates.slice(pageStart, pageStart + pageSize);
  const shownEnd = pageStart + visible.length;
  const totalFound = options.totalFound ?? options.candidates.length;
  const bufferHasMore = shownEnd < options.candidates.length;
  const sourceHasMore = shownEnd < totalFound || (options.hasMore === true && !bufferHasMore);
  const hasMore = options.hasMore ?? (bufferHasMore || sourceHasMore);
  const rangeText =
    totalFound > visible.length || pageStart > 0
      ? ` (แสดง ${pageStart + 1}-${shownEnd}${totalFound ? ` จาก ${totalFound}` : ""})`
      : "";
  const prompt = bufferHasMore
    ? options.profile?.replyStyle.moreResultsPrompt
    : sourceHasMore
      ? options.profile?.replyStyle.refineMoreResultsPrompt
      : options.profile?.replyStyle.multiMatchPrompt;

  return [
    `เจอหลายรายการสำหรับ "${options.keyword}"${rangeText}`,
    ...visible.map((product, index) => {
      const id = entityDisplayId(product.entity, product.code);
      const label = entityDisplayLabel(product.entity, product.name);
      return `${index + 1}. ${id} - ${label}`;
    }),
    prompt ?? (hasMore ? "ตอบเลข 1-5 เพื่อเลือกรายการ หรือส่งคำค้นให้เจาะจงขึ้น" : "ตอบเลข 1-5 เพื่อเลือกรายการ")
  ].join("\n");
}

function formatUnsupportedReply(reason: string, profile?: BusinessProfile): string {
  if (!profile) return "ส่งชื่อรายการ รหัส รุ่น หรือรายละเอียดมาได้เลยครับ";

  const friendlyKind = nonLookupKindFromReason(reason);
  if (friendlyKind === "help_question") return formatBusinessProfileHelp(profile);
  if (friendlyKind === "greeting" || friendlyKind === "thanks" || friendlyKind === "acknowledgement") {
    return profile.replyStyle.greetingMessage;
  }
  if (friendlyKind === "empty" || friendlyKind === "emoji_only") return profile.replyStyle.unsupportedMessage;

  const lines = [profile.replyStyle.unsupportedMessage, profile.replyStyle.lookupHintMessage].filter(
    (line, index, all) => line && all.indexOf(line) === index
  );
  return lines.join("\n");
}

function formatSuccess(result: Extract<LookupResult, { status: "success" }>): string {
  const entity = result.entity ?? result.product.entity;
  const lines = [
    `${entityDisplayId(entity, result.product.code)} - ${entityDisplayLabel(entity, result.product.name)}`
  ];

  if (result.stock) {
    lines.push("", "สต็อก:");
    lines.push(...formatStock(result.stock));
  }

  if (result.prices) {
    lines.push("", "ราคา:");
    lines.push(...formatPrices(result.prices));
  }

  const demoLabel = result.tenantStatus === "demo" ? " (demo data)" : "";
  lines.push("", `แหล่งข้อมูล: ${result.datasetLabel}${demoLabel}${result.cacheHit ? " (cache)" : ""}`);
  return lines.join("\n");
}

function formatStock(stock: StockLine[]): string[] {
  if (stock.length === 0) return ["- ไม่พบยอดคงเหลือ"];
  return stock.slice(0, 8).map((line) => {
    const place = [line.warehouse, line.location].filter(Boolean).join("/");
    const qty = Number.isInteger(line.qty) ? String(line.qty) : line.qty.toFixed(2);
    return `- ${place || "ไม่ระบุคลัง"}: ${qty}${line.unit ? ` ${line.unit}` : ""}`;
  });
}

function formatPrices(prices: PriceLine[]): string[] {
  if (prices.length === 0) return ["- ไม่พบราคา"];
  return prices.slice(0, 5).map((line) => {
    const unit = line.unitName ?? line.unitCode ?? "หน่วย";
    const source = line.source ? ` (${line.source})` : "";
    return `- ${unit}: ${formatMoney(line.price)} บาท${source}`;
  });
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("th-TH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(value);
}
