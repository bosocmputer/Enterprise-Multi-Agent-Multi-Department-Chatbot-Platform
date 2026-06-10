import { describe, expect, it, vi } from "vitest";
import { SmlClient, SmlClientError } from "./smlClient.js";

describe("SmlClient", () => {
  it("parses search_product envelope and normalizes candidates", async () => {
    const client = new SmlClient({
      baseUrl: "http://sml.test",
      accessMode: "sales",
      timeoutMs: 1000,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  total_found: 1,
                  products: [{ code: "PAINT-01424", name: "Beger น้ำมันสน", unit: "ถัง" }]
                })
              }
            ]
          }),
          { status: 200 }
        )
    });

    await expect(client.searchProduct("น้ำมัน", 3)).resolves.toEqual([
      { code: "PAINT-01424", name: "Beger น้ำมันสน", unit: "ถัง" }
    ]);
  });

  it("throws on malformed envelope", async () => {
    const client = new SmlClient({
      baseUrl: "http://sml.test",
      accessMode: "sales",
      timeoutMs: 1000,
      fetchImpl: async () => new Response(JSON.stringify({ content: [] }), { status: 200 })
    });

    await expect(client.searchProduct("น้ำมัน")).rejects.toThrow("Missing SML content text");
  });

  it("opens and recovers the circuit after repeated failures", async () => {
    vi.useFakeTimers();
    const client = new SmlClient({
      baseUrl: "http://sml.test",
      accessMode: "sales",
      circuitFailureThreshold: 2,
      circuitOpenSeconds: 1,
      timeoutMs: 1000,
      fetchImpl: async () => new Response("bad", { status: 500 })
    });

    await expect(client.searchProduct("น้ำมัน")).rejects.toThrow("SML HTTP 500");
    await expect(client.searchProduct("น้ำมัน")).rejects.toThrow("SML HTTP 500");
    await expect(client.searchProduct("น้ำมัน")).rejects.toMatchObject({ code: "circuit_open" } satisfies Partial<SmlClientError>);
    await expect(client.health()).resolves.toBe(false);

    await vi.advanceTimersByTimeAsync(1100);
    await expect(client.searchProduct("น้ำมัน")).rejects.toThrow("SML HTTP 500");
    vi.useRealTimers();
  });
});
