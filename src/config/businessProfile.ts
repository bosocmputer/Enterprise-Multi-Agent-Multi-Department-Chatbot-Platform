import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { z } from "zod";

export const lookupIntentSchema = z.enum(["search_product", "stock", "price", "stock_price"]);

const phraseSchema = z.array(z.string().min(1)).default([]);

const defaultReplyStyle = {
  fallbackProductHints: "ลองส่งรหัสสินค้า รุ่น ยี่ห้อ หรือคำค้นที่เฉพาะเจาะจงขึ้น",
  helpFooter: "ถ้าผมเจอหลายรายการ ให้ตอบเลข 1-5 เพื่อเลือก หรือพิมพ์ \"เพิ่ม\" เพื่อดูรายการต่อไป",
  helpIntro: "ส่งชื่อสินค้า รหัส รุ่น หรือยี่ห้อมาได้เลยครับ ผมจะช่วยเช็กสต็อก/ราคาให้จาก SML",
  moreResultsPrompt: "ตอบเลข 1-5 เพื่อเลือกรายการ หรือพิมพ์ \"เพิ่ม\" เพื่อดูรายการต่อไป",
  multiMatchPrompt: "ตอบเลข 1-5 เพื่อเลือกรายการ หรือส่งรหัสสินค้า/คำค้นที่เจาะจงขึ้น",
  noContextPrompt: "ยังไม่มีรายการล่าสุดให้เลือก กรุณาส่งรหัสสินค้า ชื่อสินค้า หรือค้นหาสินค้าก่อน",
  noMoreResultsPrompt: "แสดงรายการชุดนี้ครบแล้วครับ ถ้ายังไม่เจอ ลองส่งคำค้นให้เฉพาะเจาะจงขึ้น"
};

export const businessProfileSchema = z
  .object({
    aliases: z
      .array(
        z.object({
          from: z.string().min(1),
          to: z.array(z.string().min(1)).min(1)
        })
      )
      .default([]),
    businessType: z.string().min(1),
    enabledIntents: z.array(lookupIntentSchema).min(1).default(["search_product", "stock", "price", "stock_price"]),
    examples: z
      .array(
        z.object({
          intent: lookupIntentSchema,
          keyword: z.string().min(1),
          text: z.string().min(1)
        })
      )
      .default([]),
    fillerPhrases: z.array(z.string().min(1)).default([]),
    helpExamples: z.array(z.string().min(1)).default([]),
    intentPatterns: z
      .array(
        z.object({
          intent: lookupIntentSchema,
          keywordGroup: z.string().min(1).default("keyword"),
          pattern: z.string().min(1)
        })
      )
      .default([]),
    intentPhrases: z
      .object({
        price: phraseSchema,
        search_product: phraseSchema,
        stock: phraseSchema,
        stock_price: phraseSchema
      })
      .default({ price: [], search_product: [], stock: [], stock_price: [] }),
    locale: z.string().min(2).default("th-TH"),
    replyStyle: z
      .object({
        fallbackProductHints: z.string().default(defaultReplyStyle.fallbackProductHints),
        helpFooter: z.string().default(defaultReplyStyle.helpFooter),
        helpIntro: z.string().default(defaultReplyStyle.helpIntro),
        moreResultsPrompt: z.string().default(defaultReplyStyle.moreResultsPrompt),
        multiMatchPrompt: z.string().default(defaultReplyStyle.multiMatchPrompt),
        noContextPrompt: z.string().default(defaultReplyStyle.noContextPrompt),
        noMoreResultsPrompt: z.string().default(defaultReplyStyle.noMoreResultsPrompt)
      })
      .default(defaultReplyStyle),
    sml: z
      .object({
        datasetLabel: z.string().min(1).optional(),
        tenantStatus: z.enum(["demo", "real"]).optional()
      })
      .default({}),
    tenantId: z.string().min(1)
  })
  .superRefine((profile, ctx) => {
    for (const [index, item] of profile.intentPatterns.entries()) {
      try {
        new RegExp(item.pattern, "iu");
      } catch (error) {
        ctx.addIssue({
          code: "custom",
          message: `Invalid intent pattern: ${(error as Error).message}`,
          path: ["intentPatterns", index, "pattern"]
        });
      }
    }
  });

export type BusinessProfile = z.infer<typeof businessProfileSchema>;

export function loadBusinessProfile(profilePath: string): BusinessProfile {
  const resolvedPath = isAbsolute(profilePath) ? profilePath : resolve(process.cwd(), profilePath);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(resolvedPath, "utf8"));
  } catch (error) {
    throw new Error(`Failed to read business profile ${resolvedPath}: ${(error as Error).message}`);
  }

  const parsed = businessProfileSchema.safeParse(raw);
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid business profile ${resolvedPath}: ${message}`);
  }
  return parsed.data;
}

export function formatBusinessProfileHelp(profile: BusinessProfile): string {
  const examples = profile.helpExamples.length > 0 ? profile.helpExamples : profile.examples.map((item) => item.text);
  return [
    profile.replyStyle.helpIntro,
    ...examples.slice(0, 5).map((example) => `- ${example}`),
    profile.replyStyle.helpFooter
  ].join("\n");
}

export function phraseForIntent(profile: BusinessProfile, intent: "price" | "search_product" | "stock"): string {
  return profile.intentPhrases[intent][0] ?? fallbackIntentPhrase(intent);
}

function fallbackIntentPhrase(intent: "price" | "search_product" | "stock"): string {
  switch (intent) {
    case "price":
      return "ราคา";
    case "search_product":
      return "ค้นหา";
    case "stock":
      return "มีไหม";
  }
}
