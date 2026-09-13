import { getEnv } from "@/config/env";
import { getSourceQualityConfig } from "@/lib/scoring/source-quality";

export const appDefaults = {
  get recencyHours() {
    return getEnv().NEWS_RECENCY_HOURS;
  },
  get briefingCacheTtlSeconds() {
    return getEnv().BRIEFING_CACHE_TTL_SECONDS;
  },
  get newsFetchCacheTtlSeconds() {
    return getEnv().NEWS_FETCH_CACHE_TTL_SECONDS;
  },
  get maxArticlesPerSearch() {
    return getEnv().MAX_ARTICLES_PER_SEARCH;
  },
  get maxStoriesPerBriefing() {
    return getEnv().MAX_STORIES_PER_BRIEFING;
  },
  get newsProviderTimeoutMs() {
    return getEnv().NEWS_PROVIDER_TIMEOUT_MS;
  },
  get newsProviderMaxRetries() {
    return getEnv().NEWS_PROVIDER_MAX_RETRIES;
  },
} as const;

/**
 * Domain lists for source tiers — loaded from configurable JSON.
 * Tiers describe citation patterns, not political neutrality.
 */
export const sourceTiers = {
  1: getSourceQualityConfig().tiers["1"].domains,
  2: getSourceQualityConfig().tiers["2"].domains,
  3: getSourceQualityConfig().tiers["3"].domains,
} as const;
