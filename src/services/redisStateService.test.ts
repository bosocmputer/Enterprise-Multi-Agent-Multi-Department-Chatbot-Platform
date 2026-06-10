import { describe, expect, it } from "vitest";
import { RedisStateService } from "./redisStateService.js";

class FakeRedis {
  readonly values = new Map<string, string>();
  readonly expires = new Map<string, number>();

  async get(key: string) {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string, ...args: string[]) {
    if (args.includes("NX") && this.values.has(key)) return null;
    this.values.set(key, value);
    const exIndex = args.indexOf("EX");
    if (exIndex >= 0) {
      this.expires.set(key, Number(args[exIndex + 1]));
    }
    return "OK";
  }

  async incr(key: string) {
    const next = Number(this.values.get(key) ?? "0") + 1;
    this.values.set(key, String(next));
    return next;
  }

  async expire(key: string, seconds: number) {
    this.expires.set(key, seconds);
    return 1;
  }

  async ping() {
    return "PONG";
  }

  async quit() {
    return "OK";
  }
}

describe("RedisStateService", () => {
  it("stores JSON values with TTL", async () => {
    const redis = new FakeRedis();
    const service = new RedisStateService(redis);

    await service.set("k", { ok: true }, 30);

    await expect(service.get("k")).resolves.toEqual({ ok: true });
    expect(redis.expires.get("k")).toBe(30);
  });

  it("claims a dedup key only once", async () => {
    const service = new RedisStateService(new FakeRedis());

    await expect(service.claim("dedup:1", 60)).resolves.toBe(true);
    await expect(service.claim("dedup:1", 60)).resolves.toBe(false);
  });

  it("rate limits within a fixed window", async () => {
    const service = new RedisStateService(new FakeRedis());

    await expect(service.consume("rl:1", 2, 60)).resolves.toMatchObject({ allowed: true, count: 1 });
    await expect(service.consume("rl:1", 2, 60)).resolves.toMatchObject({ allowed: true, count: 2 });
    await expect(service.consume("rl:1", 2, 60)).resolves.toMatchObject({ allowed: false, count: 3 });
  });

  it("reports Redis readiness using ping", async () => {
    const service = new RedisStateService(new FakeRedis());

    await expect(service.isReady()).resolves.toBe(true);
  });
});
