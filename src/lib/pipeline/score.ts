import { getScoringConfig, type ScoringConfig } from "@/config/scoring";
import type { NormalizedArticle } from "@/lib/pipeline/normalize";
import { sourceTierScore } from "@/lib/scoring/source-quality";
import { relevanceScore } from "@/lib/utils/text";
import type { StoryScores } from "@/types/briefing";

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Topic relevance for a cluster (max of member article scores). */
export function calculateRelevance(
  articles: NormalizedArticle[],
  topic: string,
): number {
  if (articles.length === 0) return 0;
  let best = 0;
  for (const article of articles) {
    best = Math.max(best, relevanceScore(topic, article.title, article.snippet));
  }
  return clamp01(best);
}

/**
 * Freshness: exponential decay from latest publication time.
 * Missing dates score low but non-zero so undated items are not discarded.
 */
export function calculateFreshness(
  articles: NormalizedArticle[],
  now: Date = new Date(),
  config: ScoringConfig = getScoringConfig(),
): number {
  const timestamps = articles
    .map((article) => (article.publishedAt ? Date.parse(article.publishedAt) : NaN))
    .filter((value) => !Number.isNaN(value));

  if (timestamps.length === 0) {
    return 0.15;
  }

  const latest = Math.max(...timestamps);
  const ageHours = Math.max(0, (now.getTime() - latest) / (1000 * 60 * 60));
  const halfLife = config.FRESHNESS_HALF_LIFE_HOURS;
  return clamp01(Math.pow(0.5, ageHours / halfLife));
}

/** Source diversity: unique outlets, saturating at configured count. */
export function calculateSourceDiversity(
  articles: NormalizedArticle[],
  config: ScoringConfig = getScoringConfig(),
): number {
  const sources = new Set(
    articles.map((article) => article.sourceName.trim().toLowerCase()).filter(Boolean),
  );
  return clamp01(sources.size / config.SOURCE_DIVERSITY_SATURATION);
}

/** Average source-quality score across unique sources in the cluster. */
export function calculateSourceQuality(articles: NormalizedArticle[]): number {
  if (articles.length === 0) return 0;

  const bestBySource = new Map<string, number>();
  for (const article of articles) {
    const key = article.sourceName.trim().toLowerCase();
    const score = sourceTierScore(article.sourceTier ?? 3);
    const existing = bestBySource.get(key) ?? 0;
    if (score > existing) {
      bestBySource.set(key, score);
    }
  }

  const values = [...bestBySource.values()];
  if (values.length === 0) return 0;
  return clamp01(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function calculateImportanceScore(
  parts: {
    relevance: number;
    freshness: number;
    sourceDiversity: number;
    sourceQuality: number;
  },
  config: ScoringConfig = getScoringConfig(),
): number {
  const { weights } = config;
  return clamp01(
    parts.relevance * weights.relevance +
      parts.freshness * weights.freshness +
      parts.sourceDiversity * weights.sourceDiversity +
      parts.sourceQuality * weights.sourceQuality,
  );
}

export function scoreCluster(
  articles: NormalizedArticle[],
  topic: string,
  now: Date = new Date(),
  config: ScoringConfig = getScoringConfig(),
): StoryScores {
  const relevance = calculateRelevance(articles, topic);
  const freshness = calculateFreshness(articles, now, config);
  const sourceDiversity = calculateSourceDiversity(articles, config);
  const sourceQuality = calculateSourceQuality(articles);
  const rank = calculateImportanceScore(
    { relevance, freshness, sourceDiversity, sourceQuality },
    config,
  );

  return {
    relevance: round4(relevance),
    freshness: round4(freshness),
    sourceDiversity: round4(sourceDiversity),
    sourceQuality: round4(sourceQuality),
    rank: round4(rank),
  };
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
