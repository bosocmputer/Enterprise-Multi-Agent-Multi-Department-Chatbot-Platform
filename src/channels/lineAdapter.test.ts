import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadBusinessProfile } from "../config/businessProfile.js";
import type { LookupLlmParser } from "../core/llmParser.js";
import { LookupOrchestrator } from "../core/lookupOrchestrator.js";
import { SmlClient } from "../integrations/smlClient.js";
import { createLogger } from "../observability/logger.js";
import { MemoryCacheService } from "../services/cacheService.js";
import type { AlertSender } from "./channelAlerts.js";
import { LineAdapter } from "./lineAdapter.js";

const profile = loadBusinessProfile("profiles/construction-demo.json");

function signature(secret: string, rawBody: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("base64");
}

function createLookup() {
  return new LookupOrchestrator(
    {
      searchProduct: async () => [{ code: "PAINT-01424", name: "Beger น้ำมันสน 100 เมตร (Premium)" }],
      getProductPrice: async () => [{ unitName: "ถัง", price: 99 }]
    } as unknown as SmlClient,
    new MemoryCacheService(),
    { businessProfile: profile, datasetLabel: "test", tenantStatus: "demo" }
  );
}

describe("LineAdapter", () => {
  it("verifies LINE signatures", () => {
    const adapter = new LineAdapter({
      businessProfile: profile,
      channelAccessToken: "line-token",
      channelSecret: "line-secret",
      groupPrefixes: ["/"]
    });
    const rawBody = JSON.stringify({ events: [] });

    expect(adapter.verifySignature(rawBody, signature("line-secret", rawBody))).toBe(true);
    expect(adapter.verifySignature(rawBody, signature("wrong", rawBody))).toBe(false);
  });

  it("handles private messages, gated group messages, ignored chatter, and duplicates", async () => {
    const state = new MemoryCacheService();
    const sent: unknown[] = [];
    const adapter = new LineAdapter({
      businessProfile: profile,
      channelAccessToken: "line-token",
      channelSecret: "line-secret",
      contextStore: state,
      dedupStore: state,
      fetchImpl: async (_input, init) => {
        sent.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({}), { status: 200 });
      },
      groupPrefixes: ["/"],
      logger: createLogger({ LOG_LEVEL: "silent" }),
      rateLimiter: state
    });

    const result = await adapter.handleWebhook(
      {
        events: [
          {
            type: "message",
            webhookEventId: "evt-1",
            replyToken: "reply-1",
            source: { type: "user", userId: "u1" },
            message: { id: "m1", type: "text", text: "PAINT-01424 ราคา" }
          },
          {
            type: "message",
            webhookEventId: "evt-2",
            replyToken: "reply-2",
            source: { type: "group", groupId: "g1", userId: "u2" },
            message: { id: "m2", type: "text", text: "/PAINT-01424 ราคา" }
          },
          {
            type: "message",
            webhookEventId: "evt-3",
            replyToken: "reply-3",
            source: { type: "group", groupId: "g1", userId: "u2" },
            message: { id: "m3", type: "text", text: "คุยกันเฉย ๆ" }
          },
          {
            type: "message",
            webhookEventId: "evt-1",
            replyToken: "reply-4",
            source: { type: "user", userId: "u1" },
            message: { id: "m4", type: "text", text: "PAINT-01424 ราคา" }
          }
        ]
      },
      createLookup()
    );

    expect(result).toEqual({ handled: 2, ignored: 2 });
    expect(sent).toHaveLength(2);
  });

  it("alerts when SML lookup fails and LINE receives a safe fallback", async () => {
    const alerts: Array<{ key: string; message: string }> = [];
    const sent: Array<{ messages: Array<{ text: string }> }> = [];
    const adapter = new LineAdapter({
      alerts: {
        send: async (key, message) => {
          alerts.push({ key, message });
        }
      } satisfies AlertSender,
      businessProfile: profile,
      channelAccessToken: "line-token",
      channelSecret: "line-secret",
      fetchImpl: async (_input, init) => {
        sent.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({}), { status: 200 });
      },
      groupPrefixes: ["/"]
    });
    const lookup = new LookupOrchestrator(
      {
        searchProduct: async () => {
          throw new Error("SML unavailable");
        }
      } as unknown as SmlClient,
      new MemoryCacheService(),
      { businessProfile: profile, datasetLabel: "test" }
    );

    const result = await adapter.handleWebhook(
      {
        events: [
          {
            type: "message",
            webhookEventId: "evt-alert",
            replyToken: "reply-alert",
            source: { type: "user", userId: "u1" },
            message: { id: "m-alert", type: "text", text: "มีปูนเหลือไหม" }
          }
        ]
      },
      lookup
    );

    expect(result).toEqual({ handled: 1, ignored: 0 });
    expect(sent[0]?.messages[0]?.text).toContain("ตอนนี้ดึงข้อมูลสินค้าไม่ได้");
    expect(alerts).toEqual([
      {
        key: "lookup_dependency_error:line:sml_error",
        message:
          "Lookup dependency error on line: sml_error. Staff received the safe fallback; check SML MCP/readiness."
      }
    ]);
  });

  it("starts LINE loading animation for one-on-one assist slow path", async () => {
    const calls: Array<{ body: unknown; url: string }> = [];
    const llmParser: LookupLlmParser = {
      metadata: { model: "openrouter/openrouter/free", provider: "litellm", timeoutMs: 6000 },
      parse: async () => ({ model: "openrouter/openrouter/free", reason: "timeout", status: "rejected" })
    };
    const adapter = new LineAdapter({
      assistStatusMinDelayMs: 0,
      assistUserStatusEnabled: true,
      businessProfile: profile,
      channelAccessToken: "line-token",
      channelSecret: "line-secret",
      fetchImpl: async (input, init) => {
        calls.push({ body: JSON.parse(String(init?.body)), url: String(input) });
        return new Response(JSON.stringify({}), { status: 200 });
      },
      groupPrefixes: ["/"]
    });
    const lookup = new LookupOrchestrator(
      {
        searchProduct: async () => []
      } as unknown as SmlClient,
      new MemoryCacheService(),
      { businessProfile: profile, datasetLabel: "test", llmParser, llmParserMode: "assist" }
    );

    await expect(
      adapter.handleWebhook(
        {
          events: [
            {
              type: "message",
              webhookEventId: "evt-assist",
              replyToken: "reply-assist",
              source: { type: "user", userId: "u1" },
              message: { id: "m-assist", type: "text", text: "มีปูนตราช้างเหลือไหม" }
            }
          ]
        },
        lookup
      )
    ).resolves.toEqual({ handled: 1, ignored: 0 });

    expect(calls[0]).toMatchObject({
      url: "https://api.line.me/v2/bot/chat/loading/start",
      body: { chatId: "u1", loadingSeconds: 6 }
    });
    expect(calls[1]?.url).toBe("https://api.line.me/v2/bot/message/reply");
    expect(JSON.stringify(calls[1]?.body)).toContain("ตีความไม่สำเร็จ");
  });
});
