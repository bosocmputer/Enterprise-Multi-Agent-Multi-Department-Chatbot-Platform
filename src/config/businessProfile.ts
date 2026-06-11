import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { z } from "zod";
import type { LookupIntent } from "../core/types.js";

export const lookupIntentSchema = z.enum(["search_product", "stock", "price", "stock_price"]);

const phraseSchema = z.array(z.string().min(1)).default([]);

const defaultReplyStyle = {
  assistFailureMessage:
    "LiteLLM assist model {model} ตีความไม่สำเร็จ ({outcome}, {durationMs}ms) กรุณาส่งรหัส รายละเอียด หรือคำค้นให้ชัดขึ้น",
  assistStartingMessage:
    "กำลังใช้ LiteLLM assist model {model} ช่วยตีความคำถามนี้ครับ ช้าเร็วขึ้นอยู่กับ model ที่ใช้งาน...",
  assistSuccessFooter: "Assist: LiteLLM {model} ช่วยตีความคำค้น; ข้อมูลจริงมาจากระบบต้นทาง",
  entityIdLabel: "รหัส",
  entityLabel: "รายการ",
  fallbackProductHints: "ลองส่งรหัส รายละเอียด หรือคำค้นที่เฉพาะเจาะจงขึ้น",
  helpFooter: "ถ้าผมเจอหลายรายการ ให้ตอบเลข 1-5 เพื่อเลือก หรือพิมพ์ \"เพิ่ม\" เพื่อดูรายการต่อไป",
  helpIntro: "ส่งชื่อรายการ รหัส รุ่น หรือรายละเอียดมาได้เลยครับ ผมจะช่วยเช็กข้อมูลจากระบบต้นทางให้",
  moreResultsPrompt: "ตอบเลข 1-5 เพื่อเลือกรายการ หรือพิมพ์ \"เพิ่ม\" เพื่อดูรายการต่อไป",
  multiMatchPrompt: "ตอบเลข 1-5 เพื่อเลือกรายการ หรือส่งรหัส/คำค้นที่เจาะจงขึ้น",
  noContextPrompt: "ยังไม่มีรายการล่าสุดให้เลือก กรุณาส่งรหัส รายละเอียด หรือค้นหารายการก่อน",
  noMoreResultsPrompt: "แสดงรายการชุดนี้ครบแล้วครับ ถ้ายังไม่เจอ ลองส่งคำค้นให้เฉพาะเจาะจงขึ้น"
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
        entityIdLabel: z.string().default(defaultReplyStyle.entityIdLabel),
        entityLabel: z.string().default(defaultReplyStyle.entityLabel),
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
    for (const [connectorIndex, connector] of profile.domain?.connectors.entries() ?? []) {
      if (!connector.readOnly) {
        ctx.addIssue({
          code: "custom",
          message: "Connector write policy is not allowed for this read-only lookup service",
          path: ["domain", "connectors", connectorIndex, "readOnly"]
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
  });

export type BusinessProfile = z.infer<typeof businessProfileSchema>;
export type DomainProfileV2 = z.infer<typeof domainProfileSchema>;
export type DomainActionProfile = DomainProfileV2["actions"][number];
export type DomainConnectorProfile = DomainProfileV2["connectors"][number];

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
