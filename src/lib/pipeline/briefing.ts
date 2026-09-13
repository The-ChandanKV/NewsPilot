import { getEnv } from "@/config/env";
import { briefingCache } from "@/lib/cache/memory";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import {
  assessClusterChange,
  buildWhatsNewSummary,
  clusterArticleUrls,
  emptyWhatsNew,
  finalizeStoryChange,
  matchPriorStory,
  priorToStorySummary,
  type TopicBriefingSnapshot,
} from "@/lib/pipeline/change-detection";
import { maybeExplainChangeWithAi } from "@/lib/pipeline/change-explain";
import {
  selectBriefingStories,
  toDailyBriefingStory,
} from "@/lib/pipeline/briefing-format";
import { processNewsForTopic } from "@/lib/pipeline/process";
import { storyContentHash } from "@/lib/pipeline/summarize-input";
import { summarizeStoryClusters } from "@/lib/pipeline/summarize";
import {
  loadTopicSnapshot,
  saveBriefingAsTopicSnapshot,
} from "@/lib/pipeline/topic-history";
import { getLlmProvider } from "@/lib/providers/llm/router";
import type { LlmProvider } from "@/lib/providers/llm/types";
import { normalizeTopic } from "@/lib/utils/text";
import type {
  DailyBriefing,
  StoryChangeInfo,
  StoryCluster,
  StorySummary,
  SummarizedStory,
} from "@/types/briefing";

type ProcessNewsResult = Awaited<ReturnType<typeof processNewsForTopic>>;
type SummarizeResult = Awaited<ReturnType<typeof summarizeStoryClusters>>;

export type BuildBriefingOptions = {
  maxResults?: number;
  maxStories?: number;
  recencyHours?: number;
  forceRefresh?: boolean;
  provider?: LlmProvider;
  now?: Date;
  /** Test seams — avoid live network/AI in unit tests. */
  processNews?: (
    topic: string,
    options?: {
      maxResults?: number;
      maxStories?: number;
      recencyHours?: number;
      forceRefresh?: boolean;
      now?: Date;
    },
  ) => Promise<ProcessNewsResult>;
  summarize?: (
    clusters: StoryCluster[],
    topic: string,
    options?: {
      provider?: LlmProvider;
      maxStories?: number;
      forceRefresh?: boolean;
      reuseByClusterId?: Map<string, StorySummary>;
    },
  ) => Promise<SummarizeResult>;
  /** Inject prior snapshot in tests. */
  loadSnapshot?: (topic: string) => TopicBriefingSnapshot | null;
  /** Disable persisting history (tests that only care about one pass). */
  persistSnapshot?: boolean;
};

function briefingCacheKey(parts: {
  topic: string;
  recencyHours: number;
  maxStories: number;
  provider: string;
}): string {
  return [
    "briefing",
    normalizeTopic(parts.topic),
    `h${parts.recencyHours}`,
    `n${parts.maxStories}`,
    parts.provider,
  ].join(":");
}

function buildTimeRange(hours: number, now: Date) {
  const to = now.toISOString();
  const from = new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();
  return { from, to, hours };
}

function planClusterChanges(args: {
  clusters: StoryCluster[];
  snapshot: TopicBriefingSnapshot | null;
  topic: string;
  nowIso: string;
  maxArticles: number;
}): {
  changesByClusterId: Map<string, StoryChangeInfo>;
  reuseByClusterId: Map<string, StorySummary>;
} {
  const changesByClusterId = new Map<string, StoryChangeInfo>();
  const reuseByClusterId = new Map<string, StorySummary>();
  const usedPriorIds = new Set<string>();
  const priors = args.snapshot?.stories ?? [];

  for (const cluster of args.clusters) {
    const urls = clusterArticleUrls(cluster);
    const prior = matchPriorStory(urls, priors, usedPriorIds);
    if (prior) {
      usedPriorIds.add(prior.stableId);
    }

    const contentHash = storyContentHash(cluster, args.topic, args.maxArticles);
    const change = assessClusterChange({
      cluster,
      contentHash,
      prior,
      nowIso: args.nowIso,
    });
    changesByClusterId.set(cluster.id, change);

    if (prior && !change.materialChange) {
      reuseByClusterId.set(cluster.id, priorToStorySummary(prior));
    }
  }

  return { changesByClusterId, reuseByClusterId };
}

/**
 * Daily topic briefing service:
 * ingest → cluster/rank → summarize important clusters → format + cache.
 * Compares against the previous topic snapshot for NEW / UPDATED / ONGOING.
 */
export async function buildBriefingForTopic(
  topicInput: string,
  options: BuildBriefingOptions = {},
): Promise<DailyBriefing> {
  const topic = topicInput.trim();
  if (!topic) {
    throw new AppError("Query parameter 'topic' is required", {
      statusCode: 400,
      code: "INVALID_TOPIC",
    });
  }

  const env = getEnv();
  const now = options.now ?? new Date();
  const recencyHours = options.recencyHours ?? env.NEWS_RECENCY_HOURS;
  const maxStories =
    options.maxStories ??
    Math.min(env.MAX_STORIES_PER_BRIEFING, env.MAX_STORIES_TO_SUMMARIZE);
  const provider = options.provider ?? getLlmProvider();
  const processNews = options.processNews ?? processNewsForTopic;
  const summarize = options.summarize ?? summarizeStoryClusters;
  const loadSnapshot = options.loadSnapshot ?? loadTopicSnapshot;
  const persistSnapshot = options.persistSnapshot !== false;

  const cacheKey = briefingCacheKey({
    topic,
    recencyHours,
    maxStories,
    provider: provider.name,
  });

  if (!options.forceRefresh) {
    const cached = briefingCache.get<DailyBriefing>(cacheKey);
    if (cached) {
      logger.info("Briefing cache hit", { topic: normalizeTopic(topic) });
      return { ...cached, cached: true };
    }
  }

  const warnings: string[] = [];
  const previousSnapshot = loadSnapshot(topic);

  const processed = await processNews(topic, {
    maxResults: options.maxResults,
    maxStories: Math.max(maxStories * 2, maxStories),
    recencyHours,
    forceRefresh: options.forceRefresh,
    now,
  });

  if (processed.providersFailed.length > 0) {
    for (const failure of processed.providersFailed) {
      warnings.push(
        `News provider ${failure.provider} failed: ${failure.message}`,
      );
    }
  }

  if (processed.stories.length === 0) {
    const empty: DailyBriefing = {
      topic: processed.topic,
      generatedAt: now.toISOString(),
      timeRange: buildTimeRange(recencyHours, now),
      totalStories: 0,
      cached: false,
      llmCalls: 0,
      summaryCacheHits: 0,
      providerUsed: provider.name,
      stories: [],
      whatsNew: emptyWhatsNew(
        previousSnapshot
          ? "What's new since your last briefing"
          : "What's new (first briefing for this topic)",
      ),
      warnings: [...warnings, "No stories found for this topic in the time range."],
    };
    briefingCache.set(cacheKey, empty, env.BRIEFING_CACHE_TTL_SECONDS);
    return empty;
  }

  // Only summarize top candidates we may return — avoids unnecessary AI calls.
  const candidates = processed.stories.slice(0, maxStories);
  const { changesByClusterId, reuseByClusterId } = planClusterChanges({
    clusters: candidates,
    snapshot: previousSnapshot,
    topic: processed.topic,
    nowIso: now.toISOString(),
    maxArticles: env.AI_SUMMARY_MAX_ARTICLES_PER_CLUSTER,
  });

  const summarized = await summarize(candidates, processed.topic, {
    provider,
    maxStories,
    forceRefresh: options.forceRefresh,
    reuseByClusterId,
  });

  const selected = selectBriefingStories(
    summarized.stories as SummarizedStory[],
    maxStories,
  );

  const stories = [];
  for (const summarizedStory of selected) {
    const baseChange =
      changesByClusterId.get(summarizedStory.id) ??
      assessClusterChange({
        cluster: summarizedStory,
        contentHash: summarizedStory.ai.contentHash,
        prior: null,
        nowIso: now.toISOString(),
      });

    let change = baseChange;
    if (
      change.status === "updated" &&
      change.changeSummary &&
      change.previousState
    ) {
      const aiLine = await maybeExplainChangeWithAi({
        deterministicSummary: change.changeSummary,
        previousHeadline: change.previousState.headline,
        currentHeadline: summarizedStory.ai.headline || summarizedStory.headline,
        provider,
      });
      if (aiLine) {
        change = { ...change, changeSummary: aiLine };
      }
    }

    const card = toDailyBriefingStory(summarizedStory, change);
    stories.push({
      ...card,
      change: finalizeStoryChange(card.change, card),
    });
  }

  const whatsNew = buildWhatsNewSummary({
    stories,
    comparedToGeneratedAt: previousSnapshot?.generatedAt ?? null,
    now,
  });

  const partialAi = selected.filter((story) => !story.ai.isAiGenerated).length;
  if (partialAi > 0) {
    warnings.push(
      `${partialAi} stor${partialAi === 1 ? "y" : "ies"} used fallback text because AI summarization was unavailable.`,
    );
  }

  const briefing: DailyBriefing = {
    topic: processed.topic,
    generatedAt: now.toISOString(),
    timeRange: buildTimeRange(recencyHours, now),
    totalStories: stories.length,
    cached: false,
    llmCalls: summarized.llmCalls,
    summaryCacheHits: summarized.cacheHits,
    providerUsed: summarized.provider,
    stories,
    whatsNew,
    warnings,
  };

  briefingCache.set(cacheKey, briefing, env.BRIEFING_CACHE_TTL_SECONDS);

  if (persistSnapshot) {
    const summariesByStoryId = new Map(
      selected.map((story) => [story.id, story.ai] as const),
    );
    saveBriefingAsTopicSnapshot(briefing, summariesByStoryId);
  }

  logger.info("Daily briefing generated", {
    topic: normalizeTopic(topic),
    totalStories: briefing.totalStories,
    llmCalls: briefing.llmCalls,
    summaryCacheHits: briefing.summaryCacheHits,
    newCount: whatsNew.newCount,
    updatedCount: whatsNew.updatedCount,
    ongoingCount: whatsNew.ongoingCount,
    warnings: warnings.length,
  });

  return briefing;
}
