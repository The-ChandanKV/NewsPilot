import type {
  DailyBriefingStory,
  StoryChangeInfo,
  SummarizedStory,
} from "@/types/briefing";
import { assessStoryVerification } from "@/lib/scoring/verification";
import type { NormalizedArticle } from "@/lib/pipeline/normalize";
import { assessClusterChange } from "@/lib/pipeline/change-detection";

/**
 * When AI summarization attaches disagreements, refresh verification so
 * contested stories surface transparent "sources disagree" signals.
 */
export function withDisagreementVerification(
  story: SummarizedStory,
): SummarizedStory {
  const disagreements = story.ai.sourceDisagreements ?? [];
  if (disagreements.length === 0) {
    return story;
  }

  const articles: NormalizedArticle[] = story.articles.map((article) => ({
    id: article.id,
    url: article.url,
    canonicalUrl: article.url,
    title: article.title,
    snippet: article.description ?? undefined,
    sourceName: article.source,
    author: article.author ?? undefined,
    publishedAt: article.publishedAt ?? undefined,
    fetchedAt: article.publishedAt ?? new Date().toISOString(),
    provider: article.provider,
    topic: article.topic,
    imageUrl: article.imageUrl ?? undefined,
    normalizedTitle: article.title.toLowerCase(),
  }));

  const verification = assessStoryVerification({
    articles,
    similarityScore: story.similarityScore,
    sourceDisagreements: disagreements,
  });

  return { ...story, verification };
}

function defaultChange(story: SummarizedStory): StoryChangeInfo {
  return assessClusterChange({
    cluster: story,
    contentHash: story.ai.contentHash,
    prior: null,
    nowIso: new Date().toISOString(),
  });
}

/**
 * Map an internal summarized cluster to the public briefing story card.
 */
export function toDailyBriefingStory(
  story: SummarizedStory,
  change: StoryChangeInfo = defaultChange(story),
): DailyBriefingStory {
  const enriched = withDisagreementVerification(story);
  const articles = enriched.articles.length
    ? enriched.articles
    : [enriched.representativeArticle, ...enriched.relatedArticles];
  const primary = enriched.representativeArticle;

  const relatedSources = articles
    .filter((article) => article.url !== primary.url)
    .map((article) => ({
      name: article.source,
      title: article.title,
      url: article.url,
    }));

  const seen = new Set<string>([primary.url]);
  const uniqueRelated = relatedSources.filter((item) => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });

  const articleUrls = [primary.url, ...uniqueRelated.map((item) => item.url)];
  const coveredBy = enriched.sources.join(" · ");

  return {
    id: enriched.id,
    headline: enriched.ai.headline || enriched.headline || enriched.primaryHeadline,
    summary: enriched.ai.summary,
    whyItMatters: enriched.ai.whyItMatters,
    keyFacts:
      enriched.ai.keyFacts.length > 0
        ? enriched.ai.keyFacts
        : enriched.ai.reportedFacts,
    entities: enriched.ai.entities,
    publishedAt: enriched.latestPublishedAt ?? primary.publishedAt,
    primarySource: primary.source,
    relatedSources: uniqueRelated,
    articleUrls,
    confidence: enriched.ai.confidence,
    uncertaintyNotes: enriched.ai.uncertaintyNotes,
    sourceDisagreements: enriched.ai.sourceDisagreements,
    isAiGenerated: enriched.ai.isAiGenerated,
    importanceScore: enriched.scores.rank,
    coveredBy,
    verification: enriched.verification,
    change,
  };
}

/**
 * Select briefing stories from ranked clusters.
 * - Clusters already collapse duplicate events
 * - Sort by importance, then freshness, then source count
 * - Soft-cap repeated primary sources to prefer briefing-level diversity
 */
export function selectBriefingStories(
  stories: SummarizedStory[],
  maxStories: number,
): SummarizedStory[] {
  const ranked = [...stories].sort((a, b) => {
    if (b.scores.rank !== a.scores.rank) {
      return b.scores.rank - a.scores.rank;
    }
    if (b.scores.freshness !== a.scores.freshness) {
      return b.scores.freshness - a.scores.freshness;
    }
    return (
      b.verification.independentSourceCount - a.verification.independentSourceCount
    );
  });

  const selected: SummarizedStory[] = [];
  const deferred: SummarizedStory[] = [];
  const primarySourceCounts = new Map<string, number>();

  for (const story of ranked) {
    if (selected.length >= maxStories) {
      break;
    }

    const primary = story.representativeArticle.source.trim().toLowerCase();
    const used = primarySourceCounts.get(primary) ?? 0;

    if (used >= 2) {
      deferred.push(story);
      continue;
    }

    selected.push(story);
    primarySourceCounts.set(primary, used + 1);
  }

  for (const story of deferred) {
    if (selected.length >= maxStories) {
      break;
    }
    selected.push(story);
  }

  return selected;
}
