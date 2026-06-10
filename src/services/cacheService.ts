interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

export interface CacheService {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
}

export interface DedupStore {
  claim(key: string, ttlSeconds: number): Promise<boolean>;
}

export interface RateLimiter {
  consume(
    key: string,
    limit: number,
    windowSeconds: number
  ): Promise<{ allowed: boolean; remaining: number; count: number }>;
}

export interface StateService extends CacheService, DedupStore, RateLimiter {
  isReady(): Promise<boolean>;
  close(): Promise<void>;
}

export class MemoryCacheService implements StateService {
  private readonly entries = new Map<string, CacheEntry<unknown>>();
  private readonly counters = new Map<string, CacheEntry<number>>();

  async get<T>(key: string): Promise<T | undefined> {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    this.entries.set(key, {
      expiresAt: Date.now() + ttlSeconds * 1000,
      value
    });
  }

  async claim(key: string, ttlSeconds: number): Promise<boolean> {
    const existing = await this.get<string>(key);
    if (existing) return false;
    await this.set(key, "1", ttlSeconds);
    return true;
  }

  async consume(key: string, limit: number, windowSeconds: number) {
    const now = Date.now();
    const existing = this.counters.get(key);
    const nextCount = existing && existing.expiresAt > now ? existing.value + 1 : 1;
    this.counters.set(key, {
      expiresAt: now + windowSeconds * 1000,
      value: nextCount
    });
    return {
      allowed: nextCount <= limit,
      remaining: Math.max(0, limit - nextCount),
      count: nextCount
    };
  }

  async isReady(): Promise<boolean> {
    return true;
  }

  async close(): Promise<void> {
    this.entries.clear();
    this.counters.clear();
  }
}
