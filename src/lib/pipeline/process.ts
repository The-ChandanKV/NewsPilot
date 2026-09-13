import { getEnv } from "@/config/env";
import { getScoringConfig, type ScoringConfig } from "@/config/scoring";
import { logger } from "@/lib/logger";
import { clusterRelatedStories } from "@/lib/pipeline/cluster";
import {
  collapseNearDuplicateHeadlines,
  dedupeExactUrls,
} from "@/lib/pipeline/dedupe";
import { fetchRawArticlesForTopic } from "@/lib/pipeline/ingest";
import { normalizeArticles } from "@/lib/pipeline/normalize";
import { buildStoryCluster, rankStories } from "@/lib/pipeline/rank";
import { getSimilarityProvider } from "@/lib/similarity";
import type { Article, StoryCluster } from "@/types/briefing";

export type DedupeStats = {
  inputCount: number;
  afterNormalization: number;
  exactUrlDuplicatesRemoved: number;
  nearDuplicatesRemoved: number;
  afterDedupe: number;
  clusterCount: number;
  /** Articles absorbed into multi-source clusters beyond one card each. */
  duplicateArticlesCollapsed: number;
  compressionRatio: number;
};

export type ProcessArticlesResult = {
  topic: string;
  processedAt: string;
  inputCount: number;
  afterUrlDedupe: number;
  afterNearDedupe: number;
  storyCount: number;
  stories: StoryCluster[];
  dedupeStats: DedupeStats;
};

export type ProcessArticlesOptions = {
  maxStories?: number;
  now?: Date;
  scoring?: ScoringConfig;
};

/**
 * Deterministic processing pipeline (no LLM):
 * normalize → URL dedupe → near-duplicate headlines → cluster → score → rank
 */
export async function processArticles(
  articles: Article[],
  topic: string,
  options: ProcessArticlesOptions = {},
): Promise<ProcessArticlesResult> {
  const config = options.scoring ?? getScoringConfig();
  const now = options.now ?? new Date();
  const maxStories = options.maxStories ?? getEnv().MAX_STORIES_PER_BRIEFING;

  const normalized = normalizeArticles(articles);
  const urlDeduped = dedupeExactUrls(normalized);
  const nearDeduped = collapseNearDuplicateHeadlines(
    urlDeduped,
    config.HEADLINE_NEAR_DUPLICATE_THRESHOLD,
  );

  const groups = await clusterRelatedStories(nearDeduped, {
    threshold: config.STORY_CLUSTER_SIMILARITY_THRESHOLD,
    similarity: getSimilarityProvider(),
  });

  const stories = rankStories(
    groups.map((group) =>
      buildStoryCluster(
        group.articles,
        topic,
        now,
        config,
        group.similarityScore,
      ),
    ),
  ).slice(0, maxStories);

  const exactUrlDuplicatesRemoved = normalized.length - urlDeduped.length;
  const nearDuplicatesRemoved = urlDeduped.length - nearDeduped.length;
  const afterDedupe = nearDeduped.length;
  const clusterCount = groups.length;
  const duplicateArticlesCollapsed = Math.max(0, afterDedupe - clusterCount);
  const compressionRatio =
    normalized.length === 0
      ? 1
      : Math.round((clusterCount / normalized.length) * 1000) / 1000;

  const dedupeStats: DedupeStats = {
    inputCount: articles.length,
    afterNormalization: normalized.length,
    exactUrlDuplicatesRemoved,
    nearDuplicatesRemoved,
    afterDedupe,
    clusterCount,
    duplicateArticlesCollapsed,
    compressionRatio,
  };

  logger.info("News processing pipeline complete", {
    topic,
    ...dedupeStats,
    storyCount: stories.length,
  });

  return {
    topic,
    processedAt: now.toISOString(),
    inputCount: articles.length,
    afterUrlDedupe: urlDeduped.length,
    afterNearDedupe: nearDeduped.length,
    storyCount: stories.length,
    stories,
    dedupeStats,
  };
}

/**
 * Ingest + process for a topic. Returns ranked story clusters.
 */
export async function processNewsForTopic(
  topic: string,
  options?: {
    maxResults?: number;
    maxStories?: number;
    recencyHours?: number;
    forceRefresh?: boolean;
    now?: Date;
  },
) {
  const raw = await fetchRawArticlesForTopic(topic, {
    maxResults: options?.maxResults,
    recencyHours: options?.recencyHours,
    forceRefresh: options?.forceRefresh,
  });

  const processed = await processArticles(raw.articles, raw.topic, {
    maxStories: options?.maxStories,
    now: options?.now,
  });

  return {
    ...processed,
    normalizedTopic: raw.normalizedTopic,
    fetchedAt: raw.fetchedAt,
    cached: raw.cached,
    providersUsed: raw.providersUsed,
    providersFailed: raw.providersFailed,
  };
}
