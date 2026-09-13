import { getEnv, getEnabledNewsProviders } from "@/config/env";
import { newsFetchCache } from "@/lib/cache/memory";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { recordAnalyticsEvent } from "@/lib/analytics/events";
import { recordNewsCacheHit } from "@/lib/metrics/runtime";
import { toNewsArticleDto } from "@/lib/pipeline/dto";
import { getEnabledNewsProviderInstances, getNewsProvider } from "@/lib/providers/news/aggregator";
import type { NewsSearchOptions } from "@/lib/providers/news/types";
import { isWithinRecencyWindow } from "@/lib/utils/dates";
import { isRelevantToTopic, normalizeTopic } from "@/lib/utils/text";
import type { Article, NewsArticleDto, NewsProviderName } from "@/types/briefing";

export type IngestNewsResult = {
  topic: string;
  normalizedTopic: string;
  fetchedAt: string;
  cached: boolean;
  count: number;
  providersUsed: NewsProviderName[];
  providersFailed: Array<{ provider: NewsProviderName; code: string; message: string }>;
  articles: NewsArticleDto[];
};

export type RawIngestResult = {
  topic: string;
  normalizedTopic: string;
  fetchedAt: string;
  cached: boolean;
  providersUsed: NewsProviderName[];
  providersFailed: Array<{ provider: NewsProviderName; code: string; message: string }>;
  articles: Article[];
};

type CachedRaw = Omit<RawIngestResult, "cached">;

function cacheKey(topic: string, recencyHours: number, maxResults: number): string {
  return `news-raw:${normalizeTopic(topic)}:${recencyHours}:${maxResults}`;
}

function dedupeByCanonicalUrl(articles: Article[]): Article[] {
  const seen = new Set<string>();
  const unique: Article[] = [];

  for (const article of articles) {
    const key = article.canonicalUrl || article.url;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(article);
  }

  return unique;
}

function filterByRecency(articles: Article[], recencyHours: number): Article[] {
  return articles.filter((article) =>
    isWithinRecencyWindow(article.publishedAt, recencyHours),
  );
}

function filterByRelevance(articles: Article[], topic: string): Article[] {
  if (articles.length === 0) {
    return articles;
  }

  const relevant = articles.filter((article) =>
    isRelevantToTopic(topic, article.title, article.snippet),
  );

  if (relevant.length === 0) {
    return articles;
  }
  if (relevant.length >= Math.ceil(articles.length * 0.5)) {
    return relevant;
  }
  return articles;
}

function sortArticles(articles: Article[]): Article[] {
  return [...articles].sort((a, b) => {
    const aTime = a.publishedAt ? Date.parse(a.publishedAt) : 0;
    const bTime = b.publishedAt ? Date.parse(b.publishedAt) : 0;
    return bTime - aTime;
  });
}

/**
 * Fetch and lightly filter raw Article objects for a topic.
 * Full story clustering happens in the processing pipeline.
 */
export async function fetchRawArticlesForTopic(
  topicInput: string,
  options?: {
    maxResults?: number;
    recencyHours?: number;
    forceRefresh?: boolean;
  },
): Promise<RawIngestResult> {
  const topic = topicInput.trim();
  if (!topic) {
    throw new AppError("Query parameter 'topic' is required", {
      statusCode: 400,
      code: "INVALID_TOPIC",
    });
  }

  const env = getEnv();
  const maxResults = options?.maxResults ?? env.MAX_ARTICLES_PER_SEARCH;
  const recencyHours = options?.recencyHours ?? env.NEWS_RECENCY_HOURS;
  const normalized = normalizeTopic(topic);
  const key = cacheKey(topic, recencyHours, maxResults);

  if (!options?.forceRefresh) {
    const cached = newsFetchCache.get<CachedRaw>(key);
    if (cached) {
      logger.info("News cache hit", { topic: normalized, count: cached.articles.length });
      recordNewsCacheHit();
      return { ...cached, cached: true };
    }
  }

  const enabledNames = getEnabledNewsProviders();
  if (enabledNames.length === 0) {
    throw new AppError("No news providers are enabled", {
      statusCode: 503,
      code: "NEWS_PROVIDERS_DISABLED",
    });
  }

  const providers = getEnabledNewsProviderInstances().filter((provider) =>
    provider.isConfigured(),
  );

  if (providers.length === 0) {
    throw new AppError("No configured news providers available", {
      statusCode: 503,
      code: "NEWS_PROVIDER_NOT_CONFIGURED",
      details: { enabled: enabledNames },
    });
  }

  const searchOptions: NewsSearchOptions = {
    topic,
    maxResults,
    recencyHours,
  };

  const collected: Article[] = [];
  const providersUsed: NewsProviderName[] = [];
  const providersFailed: RawIngestResult["providersFailed"] = [];

  await Promise.all(
    providers.map(async (provider) => {
      try {
        const articles = await provider.search(searchOptions);
        collected.push(...articles);
        providersUsed.push(provider.name);
      } catch (error) {
        const code = error instanceof AppError ? error.code : "NEWS_PROVIDER_FAILED";
        const message = error instanceof Error ? error.message : String(error);

        if (code === "NEWS_NOT_IMPLEMENTED") {
          logger.debug("Skipping unimplemented news provider", { provider: provider.name });
          return;
        }

        logger.warn("News provider failed", {
          provider: provider.name,
          code,
          message,
        });
        recordAnalyticsEvent({
          kind: "news_provider_failure",
          topic,
          provider: provider.name,
          code,
          detail: message,
        });
        providersFailed.push({ provider: provider.name, code, message });
      }
    }),
  );

  if (collected.length === 0 && providersFailed.length > 0 && providersUsed.length === 0) {
    const rateLimited = providersFailed.some((failure) => failure.code === "NEWS_RATE_LIMITED");
    throw new AppError(
      rateLimited
        ? "News providers are rate-limited. Try again shortly."
        : "All news providers failed",
      {
        statusCode: rateLimited ? 429 : 502,
        code: rateLimited ? "NEWS_RATE_LIMITED" : "NEWS_PROVIDERS_FAILED",
        details: { providersFailed },
      },
    );
  }

  const deduped = dedupeByCanonicalUrl(collected);
  const dated = filterByRecency(deduped, recencyHours);
  const relevant = filterByRelevance(dated, topic);
  const sorted = sortArticles(relevant).slice(0, maxResults);

  const payload: CachedRaw = {
    topic,
    normalizedTopic: normalized,
    fetchedAt: new Date().toISOString(),
    providersUsed,
    providersFailed,
    articles: sorted,
  };

  newsFetchCache.set(key, payload, env.NEWS_FETCH_CACHE_TTL_SECONDS);

  logger.info("News ingestion complete", {
    topic: normalized,
    count: sorted.length,
    providersUsed,
    providersFailed: providersFailed.map((item) => item.provider),
  });

  return { ...payload, cached: false };
}

/**
 * Deterministic news ingestion orchestration (no LLM).
 * Returns article DTOs for the raw news API.
 */
export async function ingestNewsForTopic(
  topicInput: string,
  options?: {
    maxResults?: number;
    recencyHours?: number;
    forceRefresh?: boolean;
  },
): Promise<IngestNewsResult> {
  const raw = await fetchRawArticlesForTopic(topicInput, options);
  return {
    topic: raw.topic,
    normalizedTopic: raw.normalizedTopic,
    fetchedAt: raw.fetchedAt,
    cached: raw.cached,
    count: raw.articles.length,
    providersUsed: raw.providersUsed,
    providersFailed: raw.providersFailed,
    articles: raw.articles.map((article) => toNewsArticleDto(article, raw.topic)),
  };
}

/** Exposed for tests / direct provider use. */
export function resolveNewsProvider(name: NewsProviderName) {
  return getNewsProvider(name);
}

export { toNewsArticleDto } from "@/lib/pipeline/dto";
