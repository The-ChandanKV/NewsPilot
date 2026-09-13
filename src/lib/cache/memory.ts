type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

export type MemoryCacheStats = {
  hits: number;
  misses: number;
  sets: number;
  size: number;
  hitRate: number;
};

/**
 * Simple in-memory TTL cache for local development.
 * Tracks hit/miss counters for cost/perf dashboards.
 * Swap for Redis later without changing call sites.
 */
export class MemoryCache {
  private store = new Map<string, CacheEntry<unknown>>();
  private hits = 0;
  private misses = 0;
  private sets = 0;
  /** In-flight async loads keyed by cache key (request coalescing). */
  private inflight = new Map<string, Promise<unknown>>();

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses += 1;
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.misses += 1;
      return undefined;
    }
    this.hits += 1;
    return entry.value as T;
  }

  /**
   * Read without bumping hit/miss counters (for probes / tests).
   */
  peek<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlSeconds: number): void {
    this.sets += 1;
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  delete(key: string): void {
    this.store.delete(key);
    this.inflight.delete(key);
  }

  clear(): void {
    this.store.clear();
    this.inflight.clear();
    this.hits = 0;
    this.misses = 0;
    this.sets = 0;
  }

  stats(): MemoryCacheStats {
    const attempts = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      sets: this.sets,
      size: this.store.size,
      hitRate: attempts > 0 ? this.hits / attempts : 0,
    };
  }

  /**
   * Coalesce concurrent misses for the same key into one loader.
   * Stores the result with the given TTL when the loader succeeds.
   */
  async getOrLoad<T>(
    key: string,
    ttlSeconds: number,
    loader: () => Promise<T>,
  ): Promise<{ value: T; cacheHit: boolean; deduped: boolean }> {
    const existing = this.get<T>(key);
    if (existing !== undefined) {
      return { value: existing, cacheHit: true, deduped: false };
    }

    const pending = this.inflight.get(key) as Promise<T> | undefined;
    if (pending) {
      const value = await pending;
      return { value, cacheHit: false, deduped: true };
    }

    const loadPromise = (async () => {
      try {
        const value = await loader();
        this.set(key, value, ttlSeconds);
        return value;
      } finally {
        this.inflight.delete(key);
      }
    })();

    this.inflight.set(key, loadPromise);
    const value = await loadPromise;
    return { value, cacheHit: false, deduped: false };
  }
}

export const newsFetchCache = new MemoryCache();
export const summaryCache = new MemoryCache();
export const briefingCache = new MemoryCache();
/** Longer-lived prior briefing snapshots for "what changed" detection. */
export const topicHistoryCache = new MemoryCache();
export const changeExplainCache = new MemoryCache();

export function getMemoryCacheSnapshot() {
  return {
    news: newsFetchCache.stats(),
    summary: summaryCache.stats(),
    briefing: briefingCache.stats(),
    topicHistory: topicHistoryCache.stats(),
    changeExplain: changeExplainCache.stats(),
  };
}
