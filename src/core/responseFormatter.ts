import { formatBusinessProfileHelp, type BusinessProfile } from "../config/businessProfile.js";
import type { LookupResult, PriceLine, StockLine } from "./types.js";

export function formatLookupReply(result: LookupResult, profile?: BusinessProfile): string {
  switch (result.status) {
    case "success":
      return formatSuccess(result);
    case "no_match":
      return [
        `ไม่พบสินค้าที่ตรงกับ "${result.keyword}"`,
        profile?.replyStyle.fallbackProductHints ?? "ลองส่งรหัสสินค้า รุ่น ยี่ห้อ หรือคำค้นที่เฉพาะเจาะจงขึ้น"
      ].join("\n");
    case "multiple_matches":
      if (result.candidates.length === 0) {
        return `ไม่พบตัวเลือกสินค้าที่ชัดเจนจาก "${result.keyword}"`;
      }
      return [
        `พบหลายรายการสำหรับ "${result.keyword}"`,
        ...result.candidates.map((product, index) => `${index + 1}. ${product.code} - ${product.name}`),
        "ตอบเลข 1-5 หรือรหัสสินค้า เพื่อเลือกรายการ"
      ].join("\n");
    case "unsupported":
      return profile ? formatBusinessProfileHelp(profile) : "ตอนนี้รองรับการถาม stock/ราคา";
    case "dependency_error":
      if (result.reason === "sml_timeout") {
        return "ระบบ SML ตอบช้าเกินไป กรุณาลองใหม่อีกครั้ง";
      }
      if (result.reason === "sml_circuit_open") {
        return "ระบบ SML มีปัญหาชั่วคราว กรุณาลองใหม่อีกครั้ง";
      }
      return "ตอนนี้ดึงข้อมูลสินค้าไม่ได้ กรุณาลองใหม่อีกครั้ง";
  }
}

function formatSuccess(result: Extract<LookupResult, { status: "success" }>): string {
  const lines = [`${result.product.code} - ${result.product.name}`];

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
