type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

/**
 * Simple in-memory TTL cache for local development.
 * Swap for Redis later without changing call sites.
 */
export class MemoryCache {
  private store = new Map<string, CacheEntry<unknown>>();

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlSeconds: number): void {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

export const newsFetchCache = new MemoryCache();
export const summaryCache = new MemoryCache();
export const briefingCache = new MemoryCache();
/** Longer-lived prior briefing snapshots for "what changed" detection. */
export const topicHistoryCache = new MemoryCache();
