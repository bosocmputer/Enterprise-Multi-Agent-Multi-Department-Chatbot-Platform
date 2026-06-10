import { Redis } from "ioredis";
import type { StateService } from "./cacheService.js";

type RedisLike = Pick<Redis, "get" | "set" | "incr" | "expire" | "ping" | "quit">;

export class RedisStateService implements StateService {
  private readonly client: RedisLike;
  private readonly ownsClient: boolean;

  constructor(redisUrlOrClient: string | RedisLike) {
    if (typeof redisUrlOrClient === "string") {
      this.client = new Redis(redisUrlOrClient, {
        lazyConnect: false,
        maxRetriesPerRequest: 2
      });
      this.ownsClient = true;
    } else {
      this.client = redisUrlOrClient;
      this.ownsClient = false;
    }
  }

  async get<T>(key: string): Promise<T | undefined> {
    const raw = await this.client.get(key);
    if (raw == null) return undefined;
    return JSON.parse(raw) as T;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    await this.client.set(key, JSON.stringify(value), "EX", ttlSeconds);
  }

  async claim(key: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.client.set(key, "1", "EX", ttlSeconds, "NX");
    return result === "OK";
  }

  async consume(key: string, limit: number, windowSeconds: number) {
    const count = await this.client.incr(key);
    if (count === 1) {
      await this.client.expire(key, windowSeconds);
    }
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      count
    };
  }

  async isReady(): Promise<boolean> {
    try {
      return (await this.client.ping()) === "PONG";
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    if (this.ownsClient) {
      await this.client.quit();
    }
  }
}
