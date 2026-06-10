import { describe, expect, it } from "vitest";
import { loadBusinessProfile } from "../config/businessProfile.js";
import { LookupOrchestrator } from "../core/lookupOrchestrator.js";
import { SmlClient } from "../integrations/smlClient.js";
import { createLogger } from "../observability/logger.js";
import { MemoryCacheService } from "../services/cacheService.js";
import type { AlertSender } from "./channelAlerts.js";
import { TelegramAdapter } from "./telegramAdapter.js";
import { TelegramPollingWorker } from "./telegramPollingWorker.js";

const profile = loadBusinessProfile("profiles/construction-demo.json");

function createLookup() {
  return new LookupOrchestrator(
    {
      getStockBalance: async () => [{ warehouse: "WH-01", qty: 3, unit: "ถัง" }],
      getProductPrice: async () => [{ unitName: "ถัง", price: 99 }]
    } as unknown as SmlClient,
    new MemoryCacheService(),
    { businessProfile: profile, datasetLabel: "test" }
  );
}

describe("TelegramPollingWorker", () => {
  it("handles private and command group messages but ignores normal group chatter and duplicates", async () => {
    const state = new MemoryCacheService();
    const sentMessages: unknown[] = [];
    let getUpdatesCalls = 0;

    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("/getUpdates")) {
        getUpdatesCalls += 1;
        return new Response(
          JSON.stringify({
            ok: true,
            result: [
              {
                update_id: 1,
                message: {
                  message_id: 10,
                  text: "PAINT-01424 ราคา",
                  chat: { id: 100, type: "private" },
                  from: { id: 1, is_bot: false }
                }
              },
              {
                update_id: 2,
                message: {
                  message_id: 11,
                  text: "/stock PAINT-01424",
                  chat: { id: -200, type: "group" },
                  from: { id: 2, is_bot: false }
                }
              },
              {
                update_id: 3,
                message: {
                  message_id: 12,
                  text: "คุยกันเฉย ๆ",
                  chat: { id: -200, type: "group" },
                  from: { id: 2, is_bot: false }
                }
              },
              {
                update_id: 1,
                message: {
                  message_id: 13,
                  text: "PAINT-01424 ราคา",
                  chat: { id: 100, type: "private" },
                  from: { id: 1, is_bot: false }
                }
              }
            ]
          })
        );
      }

      if (url.includes("/sendMessage")) {
        sentMessages.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ ok: true, result: {} }));
      }

      return new Response("not found", { status: 404 });
    };

    const adapter = new TelegramAdapter({
      botToken: "test-token",
      businessProfile: profile,
      botUsername: "parts_bot",
      fetchImpl,
      dedupStore: state,
      rateLimiter: state,
      rateLimitPerMinute: 10
    });
    const worker = new TelegramPollingWorker(adapter, createLookup(), {
      intervalMs: 1,
      timeoutSeconds: 0,
      logger: createLogger({ LOG_LEVEL: "silent" })
    });

    await expect(worker.pollOnce()).resolves.toEqual({ received: 4, handled: 2, ignored: 2 });
    expect(getUpdatesCalls).toBe(1);
    expect(sentMessages).toHaveLength(2);
  });

  it("uses short chat context so users can select a multiple-match result by number", async () => {
    const state = new MemoryCacheService();
    const sentMessages: Array<{ text: string }> = [];

    const lookup = new LookupOrchestrator(
      {
        searchProduct: async (keyword: string) =>
          keyword === "A001"
            ? [{ code: "A001", name: "สินค้า A" }]
            : [
                { code: "A001", name: "น้ำมันสินค้า A" },
                { code: "A002", name: "น้ำมันสินค้า B" }
              ],
        getProductPrice: async () => [{ unitName: "ชิ้น", price: 77 }]
      } as unknown as SmlClient,
      state,
      { businessProfile: profile, datasetLabel: "test" }
    );

    const updates = [
      {
        update_id: 10,
        message: {
          message_id: 20,
          text: "น้ำมัน ราคา",
          chat: { id: 100, type: "private" },
          from: { id: 1, is_bot: false }
        }
      },
      {
        update_id: 11,
        message: {
          message_id: 21,
          text: "1",
          chat: { id: 100, type: "private" },
          from: { id: 1, is_bot: false }
        }
      }
    ];

    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("/getUpdates")) {
        return new Response(JSON.stringify({ ok: true, result: updates.splice(0, 1) }));
      }
      if (url.includes("/sendMessage")) {
        sentMessages.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ ok: true, result: {} }));
      }
      return new Response("not found", { status: 404 });
    };

    const adapter = new TelegramAdapter({
      botToken: "test-token",
      businessProfile: profile,
      contextStore: state,
      dedupStore: state,
      fetchImpl,
      rateLimiter: state
    });
    const worker = new TelegramPollingWorker(adapter, lookup, {
      intervalMs: 1,
      timeoutSeconds: 0,
      logger: createLogger({ LOG_LEVEL: "silent" })
    });

    await expect(worker.pollOnce()).resolves.toEqual({ received: 1, handled: 1, ignored: 0 });
    await expect(worker.pollOnce()).resolves.toEqual({ received: 1, handled: 1, ignored: 0 });
    expect(sentMessages[0]?.text).toContain("พบหลายรายการ");
    expect(sentMessages[1]?.text).toContain("A001 - สินค้า A");
    expect(sentMessages[1]?.text).toContain("77");
  });

  it("alerts when SML lookup fails and the user receives a safe fallback", async () => {
    const alerts: Array<{ key: string; message: string }> = [];
    const sentMessages: Array<{ text: string }> = [];
    const lookup = new LookupOrchestrator(
      {
        searchProduct: async () => {
          throw new Error("SML unavailable");
        }
      } as unknown as SmlClient,
      new MemoryCacheService(),
      { businessProfile: profile, datasetLabel: "test" }
    );

    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("/getUpdates")) {
        return new Response(
          JSON.stringify({
            ok: true,
            result: [
              {
                update_id: 100,
                message: {
                  message_id: 200,
                  text: "มีปูนเหลือไหม",
                  chat: { id: 100, type: "private" },
                  from: { id: 1, is_bot: false }
                }
              }
            ]
          })
        );
      }
      if (url.includes("/sendMessage")) {
        sentMessages.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ ok: true, result: {} }));
      }
      return new Response("not found", { status: 404 });
    };

    const adapter = new TelegramAdapter({
      alerts: {
        send: async (key, message) => {
          alerts.push({ key, message });
        }
      } satisfies AlertSender,
      botToken: "test-token",
      businessProfile: profile,
      fetchImpl
    });
    const worker = new TelegramPollingWorker(adapter, lookup, {
      intervalMs: 1,
      timeoutSeconds: 0,
      logger: createLogger({ LOG_LEVEL: "silent" })
    });

    await expect(worker.pollOnce()).resolves.toEqual({ received: 1, handled: 1, ignored: 0 });
    expect(sentMessages[0]?.text).toContain("ตอนนี้ดึงข้อมูลสินค้าไม่ได้");
    expect(alerts).toEqual([
      {
        key: "lookup_dependency_error:telegram:sml_error",
        message:
          "Lookup dependency error on telegram: sml_error. Staff received the safe fallback; check SML MCP/readiness."
      }
    ]);
  });
});
