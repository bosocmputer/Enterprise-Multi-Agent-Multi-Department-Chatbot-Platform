import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { z } from "zod";
import type { LookupIntent } from "../core/types.js";

export const lookupIntentSchema = z.enum(["search_product", "stock", "price", "stock_price"]);

const phraseSchema = z.array(z.string().min(1)).default([]);

const defaultReplyStyle = {
  assistFailureMessage:
    "ยังตีความคำถามนี้ไม่สำเร็จ กรุณาส่งรหัส ชื่อ รุ่น ยี่ห้อ หรือคำค้นให้ชัดขึ้น",
  assistStartingMessage:
    "กำลังใช้ LiteLLM assist model {model} ช่วยตีความคำถามนี้ครับ ช้าเร็วขึ้นอยู่กับ model ที่ใช้งาน...",
  assistSuccessFooter: "Assist: LiteLLM {model} ช่วยตีความคำค้น; {sourceTruthFooter}",
  batchContextOnlyMessage:
    "ข้อความนี้ต้องใช้บริบทจากรายการล่าสุด กรุณาส่งเดี่ยว ๆ อีกครั้ง เช่น เลขรายการ คำว่าเพิ่ม หรือคำถามต่อจากรายการที่เลือก",
  batchCoachingMessage:
    "คำถามชุดนี้เป็นการขอวิธีตั้งคำค้น/ถามต่อครับ\n\nวิธีถามที่แนะนำ:\n- ถ้าต้องการตัวเลือกตามเงื่อนไข ให้ค้นกลุ่มรายการก่อน เช่น \"<คำค้น> ราคา\" แล้วเลือกจากรายการที่ระบบต้นทางเจอ\n- ถ้าต้องการรายการใกล้เคียง ให้ส่งชื่อ รุ่น ยี่ห้อ ขนาด หรือรายละเอียดหลักที่จำได้\n- ถ้าหาไม่เจอ ให้ลองลดคำให้เป็นคำหลัก หรือเพิ่มรายละเอียดที่จำได้\n\nผมจะใช้คำค้นไปเช็กกับระบบต้นทางเท่านั้น ไม่เดาราคา/สต็อกเอง",
  batchCoachingSuggestionFooter:
    "ผมจะใช้คำค้นไปเช็กกับระบบต้นทางเท่านั้น ไม่เดาราคา/สต็อกเอง",
  batchCoachingSuggestionIntro: "ลองถามแยกเป็นข้อแบบนี้ได้ครับ",
  batchMixedMessage:
    "ถ้าต้องการส่งหลายคำถามในครั้งเดียว กรุณาแยกเป็นบรรทัด และให้แต่ละบรรทัดเป็นคำถามค้นหา/เช็กข้อมูลที่ชัดเจน",
  batchTooLongMessage: "ข้อความหลายบรรทัดยาวเกินไป กรุณาส่งไม่เกิน {maxChars} ตัวอักษรต่อครั้ง",
  batchTooManyMessage: "รับหลายคำถามได้ครั้งละไม่เกิน {maxItems} บรรทัด กรุณาแบ่งส่งใหม่อีกครั้ง",
  capabilityGapMessage:
    "ข้อมูลนี้ยังไม่ได้เปิดให้บอทดึงจากระบบต้นทางครับ กรุณาแจ้งผู้ดูแลระบบต้นทางเพิ่ม read-only MCP สำหรับ {capabilityLabel} เพื่อให้ดึงข้อมูลนี้ได้ถูกต้อง",
  capabilityGapTechnicalHint: "MCP ที่แนะนำ: {suggestedReadOnlyTool}",
  entityIdLabel: "รหัส",
  entityLabel: "รายการ",
  fallbackProductHints: "ลองส่งรหัส รายละเอียด หรือคำค้นที่เฉพาะเจาะจงขึ้น",
  greetingMessage: "สวัสดีครับ ส่งชื่อรายการ รหัส รุ่น หรือรายละเอียดมาได้เลยครับ",
  helpCommandIntro: "คำสั่งที่ใช้ได้:",
  helpFooter: "ถ้าผมเจอหลายรายการ ให้ตอบเลข 1-5 เพื่อเลือก หรือพิมพ์ \"เพิ่ม\" เพื่อดูรายการต่อไป",
  helpGuideIntro: "วิธีคุยกับบอท:",
  helpGuides: [
    "ส่ง {entityIdLabel} ได้ตรง ๆ ถ้ารู้รหัส",
    "ส่งชื่อ รุ่น ยี่ห้อ หรือคำค้น พร้อมสิ่งที่อยากรู้",
    "ถ้าพบหลายรายการ ให้เลือกเลขจากรายการล่าสุด",
    "หลังเลือกแล้ว ถามต่อได้ เช่น ราคา หรือมีของไหม"
  ],
  helpIntro: "ส่งชื่อรายการ รหัส รุ่น หรือรายละเอียดมาได้เลยครับ ผมจะช่วยเช็กข้อมูลจากระบบต้นทางให้",
  lookupHintMessage: "ส่งชื่อรายการ รหัส รุ่น หรือรายละเอียดมาได้เลยครับ",
  lookupCoachingMessage:
    "วิธีถามที่ปลอดภัยคือส่งคำค้นพร้อมสิ่งที่ต้องการเช็ก เช่น\n- คำค้น + ราคา\n- คำค้น + มีของไหม\n- รหัส + มีไหม ราคา\nถ้าไม่พบ ให้ลองเพิ่มรุ่น ยี่ห้อ ขนาด หรือรหัสที่จำได้",
  moreResultsPrompt: "ตอบเลข 1-5 เพื่อเลือกรายการ หรือพิมพ์ \"เพิ่ม\" เพื่อดูรายการต่อไป",
  multiMatchPrompt: "ตอบเลข 1-5 เพื่อเลือกรายการ หรือส่งรหัส/คำค้นที่เจาะจงขึ้น",
  noContextPrompt: "ยังไม่มีรายการล่าสุดให้เลือก กรุณาส่งรหัส รายละเอียด หรือค้นหารายการก่อน",
  noMoreResultsPrompt: "แสดงรายการชุดนี้ครบแล้วครับ ถ้ายังไม่เจอ ลองส่งคำค้นให้เฉพาะเจาะจงขึ้น",
  refineMoreResultsPrompt: "ยังมีรายการมากกว่านี้ กรุณาเพิ่มรุ่น ยี่ห้อ ขนาด หรือรหัสให้ชัดขึ้น",
  refineAmbiguousResultsMessage:
    "ผมเจอผลลัพธ์กว้างเกินไป จึงยังไม่แสดงรายการเพื่อกันเลือกผิด กรุณาเพิ่มรุ่น ยี่ห้อ ขนาด หรือรหัสให้ชัดขึ้น",
  recommendationGuidanceMessage:
    "ตอนนี้ยังไม่เลือกตัวเลือกใกล้เคียงหรือถูกสุดให้อัตโนมัติครับ กรุณาค้นกลุ่มรายการก่อน แล้วเลือกจากรายการที่ระบบต้นทางเจอ หรือส่งรายละเอียดให้ชัดขึ้น",
  sourceTruthFooter: "ข้อมูลจริงมาจากระบบต้นทาง",
  acknowledgementMessage: "รับทราบครับ ส่งรายการถัดไปมาได้เลยครับ",
  outOfScopeCurrentInfoMessage:
    "ผมช่วยเช็กข้อมูลจากระบบร้านได้ครับ เรื่องอากาศ ข่าว หรือข้อมูลภายนอกยังไม่รองรับ ส่งรหัส ชื่อ รุ่น ยี่ห้อ หรือคำค้นมาได้เลยครับ",
  outOfScopeMessage:
    "ผมช่วยเช็กข้อมูลจากระบบร้านได้ครับ คำถามทั่วไปนอกงาน lookup ยังไม่รองรับ ส่งรหัส ชื่อ รุ่น ยี่ห้อ หรือคำค้นมาได้เลยครับ",
  thanksMessage: "ยินดีครับ ส่งรายการถัดไปมาได้เลยครับ",
  unsupportedMessage: "ผมยังไม่แน่ใจว่าต้องการค้นหาอะไร กรุณาส่งรหัส ชื่อ รุ่น ยี่ห้อ หรือคำค้นให้ชัดขึ้น"
};

const domainEntitySchema = z.object({
  idPattern: z.string().min(1).optional(),
  label: z.string().min(1),
  type: z.string().min(1)
});

const domainActionSchema = z.object({
  commandAliases: phraseSchema,
  entityTypes: z.array(z.string().min(1)).default([]),
  id: z.string().min(1),
  label: z.string().min(1).optional(),
  legacyIntent: lookupIntentSchema.optional(),
  phrases: phraseSchema
});

const domainConnectorSchema = z.object({
  actionToolMap: z.record(z.string(), z.string()).default({}),
  allowedTools: z.array(z.string().min(1)).default([]),
  entityTypes: z.array(z.string().min(1)).default([]),
  id: z.string().min(1),
  readOnly: z.boolean().default(true),
  source: z.string().min(1)
});

const supportedCapabilitySchema = z.object({
  action: z.string().min(1).optional(),
  entityTypes: z.array(z.string().min(1)).default([]),
  id: z.string().min(1),
  label: z.string().min(1),
  phrases: phraseSchema,
  tool: z.string().min(1).optional()
});

const requestableCapabilitySchema = z.object({
  entityTypes: z.array(z.string().min(1)).default([]),
  id: z.string().min(1),
  label: z.string().min(1),
  phrases: phraseSchema,
  requiredFields: z.array(z.string().min(1)).default([]),
  suggestedReadOnlyTool: z.string().min(1).optional()
});

const capabilityProfileSchema = z
  .object({
    requestable: z.array(requestableCapabilitySchema).default([]),
    supported: z.array(supportedCapabilitySchema).default([])
  })
  .default({ requestable: [], supported: [] });

export const domainProfileSchema = z.object({
  actions: z.array(domainActionSchema).default([]),
  connectors: z.array(domainConnectorSchema).default([]),
  defaultEntityType: z.string().min(1).default("entity"),
  entities: z.array(domainEntitySchema).default([]),
  version: z.literal(2).default(2)
});

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
    capabilities: capabilityProfileSchema,
    domain: domainProfileSchema.optional(),
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
        assistFailureMessage: z.string().default(defaultReplyStyle.assistFailureMessage),
        assistStartingMessage: z.string().default(defaultReplyStyle.assistStartingMessage),
        assistSuccessFooter: z.string().default(defaultReplyStyle.assistSuccessFooter),
        batchCoachingMessage: z.string().default(defaultReplyStyle.batchCoachingMessage),
        batchCoachingSuggestionFooter: z.string().default(defaultReplyStyle.batchCoachingSuggestionFooter),
        batchCoachingSuggestionIntro: z.string().default(defaultReplyStyle.batchCoachingSuggestionIntro),
        batchContextOnlyMessage: z.string().default(defaultReplyStyle.batchContextOnlyMessage),
        batchMixedMessage: z.string().default(defaultReplyStyle.batchMixedMessage),
        batchTooLongMessage: z.string().default(defaultReplyStyle.batchTooLongMessage),
        batchTooManyMessage: z.string().default(defaultReplyStyle.batchTooManyMessage),
        capabilityGapMessage: z.string().default(defaultReplyStyle.capabilityGapMessage),
        capabilityGapTechnicalHint: z.string().default(defaultReplyStyle.capabilityGapTechnicalHint),
        entityIdLabel: z.string().default(defaultReplyStyle.entityIdLabel),
        entityLabel: z.string().default(defaultReplyStyle.entityLabel),
        fallbackProductHints: z.string().default(defaultReplyStyle.fallbackProductHints),
        greetingMessage: z.string().default(defaultReplyStyle.greetingMessage),
        helpCommandIntro: z.string().default(defaultReplyStyle.helpCommandIntro),
        helpFooter: z.string().default(defaultReplyStyle.helpFooter),
        helpGuideIntro: z.string().default(defaultReplyStyle.helpGuideIntro),
        helpGuides: z.array(z.string().min(1)).default(defaultReplyStyle.helpGuides),
        helpIntro: z.string().default(defaultReplyStyle.helpIntro),
        lookupCoachingMessage: z.string().default(defaultReplyStyle.lookupCoachingMessage),
        lookupHintMessage: z.string().default(defaultReplyStyle.lookupHintMessage),
        moreResultsPrompt: z.string().default(defaultReplyStyle.moreResultsPrompt),
        multiMatchPrompt: z.string().default(defaultReplyStyle.multiMatchPrompt),
        noContextPrompt: z.string().default(defaultReplyStyle.noContextPrompt),
        noMoreResultsPrompt: z.string().default(defaultReplyStyle.noMoreResultsPrompt),
        acknowledgementMessage: z.string().default(defaultReplyStyle.acknowledgementMessage),
        outOfScopeCurrentInfoMessage: z.string().default(defaultReplyStyle.outOfScopeCurrentInfoMessage),
        outOfScopeMessage: z.string().default(defaultReplyStyle.outOfScopeMessage),
        refineAmbiguousResultsMessage: z.string().default(defaultReplyStyle.refineAmbiguousResultsMessage),
        refineMoreResultsPrompt: z.string().default(defaultReplyStyle.refineMoreResultsPrompt),
        recommendationGuidanceMessage: z.string().default(defaultReplyStyle.recommendationGuidanceMessage),
        sourceTruthFooter: z.string().default(defaultReplyStyle.sourceTruthFooter),
        thanksMessage: z.string().default(defaultReplyStyle.thanksMessage),
        unsupportedMessage: z.string().default(defaultReplyStyle.unsupportedMessage)
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
    if (profile.domain) {
      if (profile.domain.entities.length === 0) {
        ctx.addIssue({
          code: "custom",
          message: "Domain profile must declare at least one entity type",
          path: ["domain", "entities"]
        });
      }
      if (profile.domain.actions.length === 0) {
        ctx.addIssue({
          code: "custom",
          message: "Domain profile must declare at least one action",
          path: ["domain", "actions"]
        });
      }
      if (profile.domain.connectors.length === 0) {
        ctx.addIssue({
          code: "custom",
          message: "Domain profile must declare at least one read-only connector",
          path: ["domain", "connectors"]
        });
      }
    }
    for (const [connectorIndex, connector] of profile.domain?.connectors.entries() ?? []) {
      if (!connector.readOnly) {
        ctx.addIssue({
          code: "custom",
          message: "Connector write policy is not allowed for this read-only lookup service",
          path: ["domain", "connectors", connectorIndex, "readOnly"]
        });
      }
      if (connector.allowedTools.length === 0) {
        ctx.addIssue({
          code: "custom",
          message: "Read-only connector must declare allowed tools",
          path: ["domain", "connectors", connectorIndex, "allowedTools"]
        });
      }
      if (Object.keys(connector.actionToolMap).length === 0) {
        ctx.addIssue({
          code: "custom",
          message: "Read-only connector must map at least one domain action to a tool",
          path: ["domain", "connectors", connectorIndex, "actionToolMap"]
        });
      }
      for (const [toolIndex, tool] of connector.allowedTools.entries()) {
        if (looksLikeWriteTool(tool)) {
          ctx.addIssue({
            code: "custom",
            message: `Write-like connector tool is not allowed: ${tool}`,
            path: ["domain", "connectors", connectorIndex, "allowedTools", toolIndex]
          });
        }
      }
    }
    const connectorTools = new Set(
      (profile.domain?.connectors ?? []).flatMap((connector) => connector.allowedTools)
    );
    for (const [index, capability] of profile.capabilities.supported.entries()) {
      if (capability.tool && looksLikeWriteTool(capability.tool)) {
        ctx.addIssue({
          code: "custom",
          message: `Write-like supported capability tool is not allowed: ${capability.tool}`,
          path: ["capabilities", "supported", index, "tool"]
        });
      }
      if (capability.tool && connectorTools.size > 0 && !connectorTools.has(capability.tool)) {
        ctx.addIssue({
          code: "custom",
          message: `Supported capability tool is not declared in connector allowlist: ${capability.tool}`,
          path: ["capabilities", "supported", index, "tool"]
        });
      }
    }
    for (const [index, capability] of profile.capabilities.requestable.entries()) {
      if (capability.suggestedReadOnlyTool && looksLikeWriteTool(capability.suggestedReadOnlyTool)) {
        ctx.addIssue({
          code: "custom",
          message: `Write-like requestable capability tool is not allowed: ${capability.suggestedReadOnlyTool}`,
          path: ["capabilities", "requestable", index, "suggestedReadOnlyTool"]
        });
      }
    }
  });

export type BusinessProfile = z.infer<typeof businessProfileSchema>;
export type DomainProfileV2 = z.infer<typeof domainProfileSchema>;
export type DomainActionProfile = DomainProfileV2["actions"][number];
export type DomainConnectorProfile = DomainProfileV2["connectors"][number];
export type RequestableCapabilityProfile = BusinessProfile["capabilities"]["requestable"][number];
export type SupportedCapabilityProfile = BusinessProfile["capabilities"]["supported"][number];

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
  const commandLines = formatCommandHelp(profile);
  return [
    profile.replyStyle.helpIntro,
    profile.replyStyle.helpGuideIntro,
    ...profile.replyStyle.helpGuides.map((guide) => `• ${formatReplyStyleTemplate(profile, guide)}`),
    examples.length > 0 ? "ตัวอย่างคำถาม:" : undefined,
    ...examples.slice(0, 3).map((example) => `- ${example}`),
    commandLines.length > 0 ? profile.replyStyle.helpCommandIntro : undefined,
    ...commandLines,
    profile.replyStyle.helpFooter
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

function formatCommandHelp(profile: BusinessProfile): string[] {
  const lines = ["/start, /help - ดูคำแนะนำนี้"];
  const seen = new Set(["start", "help"]);

  for (const action of normalizeDomainProfile(profile).actions) {
    const label = action.label ?? action.id;
    for (const command of action.commandAliases) {
      const normalized = command.trim().toLowerCase();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      lines.push(`/${normalized} <คำค้น> - ${label}`);
    }
  }

  lines.push("เพิ่ม - ดูรายการต่อไปเมื่อมีหลายรายการ");
  return lines;
}

function formatReplyStyleTemplate(profile: BusinessProfile, value: string): string {
  return value
    .replaceAll("{entityIdLabel}", profile.replyStyle.entityIdLabel)
    .replaceAll("{entityLabel}", profile.replyStyle.entityLabel)
    .replaceAll("{sourceTruthFooter}", profile.replyStyle.sourceTruthFooter);
}

export function phraseForIntent(profile: BusinessProfile, intent: "price" | "search_product" | "stock"): string {
  return phrasesForLegacyIntent(profile, intent)[0] ?? fallbackIntentPhrase(intent);
}

export function normalizeDomainProfile(profile: BusinessProfile): DomainProfileV2 {
  const legacy = legacyDomainProfile(profile);
  const configured = profile.domain;
  if (!configured) return legacy;

  const defaultEntityType = configured.defaultEntityType || legacy.defaultEntityType;
  const entities = configured.entities.length > 0 ? configured.entities : legacy.entities;
  const configuredActions = configured.actions.map((action) => ({
    ...action,
    entityTypes: action.entityTypes.length > 0 ? action.entityTypes : [defaultEntityType]
  }));
  const actions = mergeActions(configuredActions, legacy.actions);
  const connectors = configured.connectors.length > 0 ? configured.connectors : legacy.connectors;

  return {
    actions,
    connectors,
    defaultEntityType,
    entities,
    version: 2
  };
}

export function actionForLegacyIntent(profile: BusinessProfile, intent: LookupIntent): DomainActionProfile | undefined {
  return normalizeDomainProfile(profile).actions.find((action) => action.legacyIntent === intent);
}

export function legacyIntentForAction(profile: BusinessProfile, actionId: string): LookupIntent | undefined {
  return normalizeDomainProfile(profile).actions.find((action) => action.id === actionId)?.legacyIntent;
}

export function defaultEntityType(profile: BusinessProfile): string {
  return normalizeDomainProfile(profile).defaultEntityType;
}

export function phrasesForLegacyIntent(profile: BusinessProfile, intent: LookupIntent): string[] {
  const actionPhrases = normalizeDomainProfile(profile).actions
    .filter((action) => action.legacyIntent === intent)
    .flatMap((action) => action.phrases);
  const phrases = [...actionPhrases, ...profile.intentPhrases[intent]];
  return [...new Set(phrases.map((phrase) => phrase.trim()).filter(Boolean))];
}

export function commandAliasesForLegacyIntents(
  profile: BusinessProfile
): Array<{ action: string; command: string; intent: LookupIntent }> {
  return normalizeDomainProfile(profile).actions.flatMap((action) => {
    if (!action.legacyIntent) return [];
    return action.commandAliases.map((command) => ({
      action: action.id,
      command: command.toLowerCase(),
      intent: action.legacyIntent as LookupIntent
    }));
  });
}

export function allDomainPhrases(profile: BusinessProfile): string[] {
  const phrases = normalizeDomainProfile(profile).actions.flatMap((action) => action.phrases);
  return [...new Set([...phrases, ...Object.values(profile.intentPhrases).flat()].filter(Boolean))];
}

export function requestableCapabilities(profile: BusinessProfile): RequestableCapabilityProfile[] {
  const defaultEntity = normalizeDomainProfile(profile).defaultEntityType;
  return profile.capabilities.requestable.map((capability) => ({
    ...capability,
    entityTypes: capability.entityTypes.length > 0 ? capability.entityTypes : [defaultEntity]
  }));
}

export function supportedCapabilities(profile: BusinessProfile): SupportedCapabilityProfile[] {
  const defaultEntity = normalizeDomainProfile(profile).defaultEntityType;
  return profile.capabilities.supported.map((capability) => ({
    ...capability,
    entityTypes: capability.entityTypes.length > 0 ? capability.entityTypes : [defaultEntity]
  }));
}

export function suggestedReadOnlyMcpTools(profile: BusinessProfile): string[] {
  return uniqueStrings(requestableCapabilities(profile).flatMap((capability) => capability.suggestedReadOnlyTool ?? []));
}

function legacyDomainProfile(profile: BusinessProfile): DomainProfileV2 {
  const entityType = profile.domain?.defaultEntityType ?? "entity";
  return {
    actions: [
      legacyAction("search", "search_product", profile.intentPhrases.search_product, ["find", "search"], entityType),
      legacyAction("availability", "stock", profile.intentPhrases.stock, ["stock"], entityType),
      legacyAction("price", "price", profile.intentPhrases.price, ["price"], entityType),
      legacyAction("availability_price", "stock_price", profile.intentPhrases.stock_price, [], entityType)
    ],
    connectors: [
      {
        actionToolMap: {
          availability: "get_stock_balance",
          price: "get_product_price",
          search: "search_product"
        },
        allowedTools: ["search_product", "get_stock_balance", "get_product_price"],
        entityTypes: [entityType],
        id: "sml-readonly",
        readOnly: true,
        source: "sml"
      }
    ],
    defaultEntityType: entityType,
    entities: [{ label: profile.replyStyle.entityLabel, type: entityType }],
    version: 2
  };
}

function legacyAction(
  id: string,
  legacyIntent: LookupIntent,
  phrases: string[],
  commandAliases: string[],
  entityType: string
): DomainActionProfile {
  return {
    commandAliases,
    entityTypes: [entityType],
    id,
    legacyIntent,
    phrases
  };
}

function mergeActions(configured: DomainActionProfile[], fallback: DomainActionProfile[]): DomainActionProfile[] {
  const actions = [...configured];
  for (const fallbackAction of fallback) {
    const matchingIndex = actions.findIndex(
      (action) => action.id === fallbackAction.id || action.legacyIntent === fallbackAction.legacyIntent
    );
    if (matchingIndex === -1) {
      actions.push(fallbackAction);
      continue;
    }
    const matching = actions[matchingIndex] as DomainActionProfile;
    actions[matchingIndex] = {
      ...matching,
      commandAliases: uniqueStrings([...matching.commandAliases, ...fallbackAction.commandAliases]),
      entityTypes: matching.entityTypes.length > 0 ? matching.entityTypes : fallbackAction.entityTypes,
      legacyIntent: matching.legacyIntent ?? fallbackAction.legacyIntent,
      phrases: uniqueStrings([...matching.phrases, ...fallbackAction.phrases])
    };
  }
  return actions;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function looksLikeWriteTool(tool: string): boolean {
  return /(^|_)(create|update|delete|reserve|write|mutate|void|cancel)(_|$)/i.test(tool);
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
