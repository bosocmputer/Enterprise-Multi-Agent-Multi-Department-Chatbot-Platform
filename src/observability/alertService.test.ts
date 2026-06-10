import { describe, expect, it } from "vitest";
import { MemoryCacheService } from "../services/cacheService.js";
import { AlertService } from "./alertService.js";

describe("AlertService", () => {
  it("deduplicates alerts with the same key", async () => {
    const sent: unknown[] = [];
    const service = new AlertService({
      botToken: "token",
      chatId: "chat",
      dedupStore: new MemoryCacheService(),
      dedupTtlSeconds: 300,
      enabled: true,
      fetchImpl: async (_input, init) => {
        sent.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
    });

    await service.send("sml_down", "SML down");
    await service.send("sml_down", "SML down");

    expect(sent).toHaveLength(1);
  });
});
