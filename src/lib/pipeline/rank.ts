import { createHash } from "crypto";
import { getScoringConfig, type ScoringConfig } from "@/config/scoring";
import type { NormalizedArticle } from "@/lib/pipeline/normalize";
import { toNewsArticleDto } from "@/lib/pipeline/dto";
import { scoreCluster } from "@/lib/pipeline/score";
import { sourceTierScore } from "@/lib/scoring/source-quality";
import { assessStoryVerification } from "@/lib/scoring/verification";
import {
  DeterministicSimilarityProvider,
  tokenizeForSimilarity,
} from "@/lib/similarity/deterministic";
import type { NewsArticleDto, StoryCluster } from "@/types/briefing";

const similarity = new DeterministicSimilarityProvider();

function publishedMs(article: NormalizedArticle): number {
  if (!article.publishedAt) return 0;
  const ms = Date.parse(article.publishedAt);
  return Number.isNaN(ms) ? 0 : ms;
}

/**
 * Prefer a recent, high-quality article as the primary/representative source.
 * Recency wins when source quality is comparable.
 */
export function pickRepresentativeArticle(
  articles: NormalizedArticle[],
): NormalizedArticle {
  return [...articles].sort((a, b) => {
    const tierA = sourceTierScore(a.sourceTier ?? 3);
    const tierB = sourceTierScore(b.sourceTier ?? 3);
    const tierGap = Math.abs(tierA - tierB);

    const timeA = publishedMs(a);
    const timeB = publishedMs(b);

    if (tierGap <= 0.15 && timeB !== timeA) {
      return timeB - timeA;
    }
    if (tierB !== tierA) {
      return tierB - tierA;
    }
    if (timeB !== timeA) {
      return timeB - timeA;
    }
    return (b.snippet?.length ?? 0) - (a.snippet?.length ?? 0);
  })[0];
}

export function selectRepresentativeHeadline(
  articles: NormalizedArticle[],
  representative: NormalizedArticle,
): string {
  if (articles.length === 1) {
    return representative.title;
  }

  const tokenSets = articles.map(
    (article) =>
      new Set(tokenizeForSimilarity(article.normalizedTitle || article.title)),
  );

  const df = new Map<string, number>();
  for (const tokens of tokenSets) {
    for (const token of tokens) {
      df.set(token, (df.get(token) ?? 0) + 1);
    }
  }
  const minDf = Math.max(1, Math.ceil(articles.length * 0.5));
  const shared = new Set(
    [...df.entries()].filter(([, count]) => count >= minDf).map(([token]) => token),
  );

  const scored = articles.map((article) => {
    const tokens = tokenizeForSimilarity(article.normalizedTitle || article.title);
    const overlap =
      shared.size === 0
        ? 0
        : tokens.filter((token) => shared.has(token)).length / shared.size;
    const lengthPenalty = Math.min(1, 12 / Math.max(tokens.length, 1));
    const tier = sourceTierScore(article.sourceTier ?? 3);
    const score = overlap * 0.55 + lengthPenalty * 0.25 + tier * 0.2;
    return { article, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0]?.article ?? representative;

  const repScore =
    scored.find((item) => item.article.id === representative.id)?.score ?? 0;
  if (repScore >= scored[0].score - 0.05) {
    return representative.title;
  }
  return best.title;
}

function firstPublishedAt(articles: NormalizedArticle[]): string | null {
  let earliest: string | null = null;
  let earliestMs = Infinity;

  for (const article of articles) {
    if (!article.publishedAt) continue;
    const ms = Date.parse(article.publishedAt);
    if (Number.isNaN(ms)) continue;
    if (ms < earliestMs) {
      earliestMs = ms;
      earliest = article.publishedAt;
    }
  }
  return earliest;
}

function latestPublishedAt(articles: NormalizedArticle[]): string | null {
  let latest: string | null = null;
  let latestMs = -Infinity;

  for (const article of articles) {
    if (!article.publishedAt) continue;
    const ms = Date.parse(article.publishedAt);
    if (Number.isNaN(ms)) continue;
    if (ms > latestMs) {
      latestMs = ms;
      latest = article.publishedAt;
    }
  }
  return latest;
}

function clusterId(articles: NormalizedArticle[]): string {
  const key = articles
    .map((article) => article.canonicalUrl || article.url)
    .sort()
    .join("|");
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

function toArticlesDto(
  articles: NormalizedArticle[],
  topic: string,
): NewsArticleDto[] {
  return articles
    .slice()
    .sort((a, b) => publishedMs(b) - publishedMs(a))
    .map((article) => toNewsArticleDto(article, topic));
}

export function buildStoryCluster(
  articles: NormalizedArticle[],
  topic: string,
  now: Date = new Date(),
  config: ScoringConfig = getScoringConfig(),
  similarityScore = 1,
): StoryCluster {
  const representative = pickRepresentativeArticle(articles);
  const headline = selectRepresentativeHeadline(articles, representative);
  const allArticles = toArticlesDto(articles, topic);
  const related = allArticles.filter((article) => article.id !== representative.id);

  const sources = [
    ...new Set(articles.map((article) => article.sourceName).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b));

  const verification = assessStoryVerification({
    articles,
    similarityScore,
    now,
    config,
  });

  return {
    id: clusterId(articles),
    headline,
    primaryHeadline: headline,
    articles: allArticles,
    sources,
    firstPublishedAt: firstPublishedAt(articles),
    latestPublishedAt: latestPublishedAt(articles),
    similarityScore,
    representativeArticle: toNewsArticleDto(representative, topic),
    relatedArticles: related,
    articleCount: articles.length,
    sourceCount: sources.length,
    scores: scoreCluster(articles, topic, now, config),
    verification,
  };
}

export function measureClusterCohesion(articles: NormalizedArticle[]): number {
  if (articles.length <= 1) return 1;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < articles.length; i += 1) {
    for (let j = i + 1; j < articles.length; j += 1) {
      sum += similarity.similarity(
        {
          title: articles[i].title,
          normalizedTitle: articles[i].normalizedTitle,
          snippet: articles[i].snippet,
        },
        {
          title: articles[j].title,
          normalizedTitle: articles[j].normalizedTitle,
          snippet: articles[j].snippet,
        },
      );
      count += 1;
    }
  }
  return count === 0 ? 1 : Math.round((sum / count) * 10000) / 10000;
}

export function rankStories(stories: StoryCluster[]): StoryCluster[] {
  return [...stories].sort((a, b) => {
    if (b.scores.rank !== a.scores.rank) {
      return b.scores.rank - a.scores.rank;
    }
    if (b.scores.freshness !== a.scores.freshness) {
      return b.scores.freshness - a.scores.freshness;
    }
    if (
      b.verification.independentSourceCount !==
      a.verification.independentSourceCount
    ) {
      return (
        b.verification.independentSourceCount -
        a.verification.independentSourceCount
      );
    }
    return b.sourceCount - a.sourceCount;
  });
}
