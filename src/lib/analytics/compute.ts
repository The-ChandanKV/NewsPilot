import { desc } from "drizzle-orm";
import { listAnalyticsEvents } from "@/lib/analytics/events";
import type {
  PipelineAnalyticsDayTrend,
  PipelineAnalyticsSnapshot,
  PipelineProviderFailureStat,
  PipelineTopicStats,
} from "@/lib/analytics/types";
import { getDb } from "@/lib/db/client";
import { jobRuns } from "@/lib/db/schema";
import { listStoredDailyBriefings } from "@/lib/jobs/daily-briefing-store";
import type {
  DailyBriefingJobResult,
  StoredDailyBriefing,
} from "@/lib/jobs/types";
import type { DailyBriefingStory } from "@/types/briefing";

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function utcDateString(date: Date): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function daysAgoUtc(days: number, now = new Date()): string {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - (days - 1));
  return utcDateString(d);
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function rate(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return numerator / denominator;
}

function sourcesForStory(story: DailyBriefingStory): number {
  if (story.verification?.sourceCount) return story.verification.sourceCount;
  if (story.coveredBy) {
    const parts = story.coveredBy.split("·").map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) return parts.length;
  }
  return Math.max(1, story.relatedSources.length + 1);
}

function warningApiFailures(warnings: string[]): number {
  return warnings.filter((warning) =>
    /news provider|providers failed|rate-limited|NEWS_/i.test(warning),
  ).length;
}

function warningAiFailures(warnings: string[]): number {
  return warnings.filter((warning) =>
    /fallback text|summarization|AI summarization|AI provider/i.test(warning),
  ).length;
}

function listJobRuns(limit = 100) {
  return getDb()
    .select()
    .from(jobRuns)
    .orderBy(desc(jobRuns.startedAt))
    .limit(limit)
    .all();
}

function buildInsights(snapshot: Omit<PipelineAnalyticsSnapshot, "insights">): string[] {
  const insights: string[] = [];
  const { totals, trends, failedProviders } = snapshot;

  if (totals.duplicateRate >= 0.45) {
    insights.push(
      `High duplicate rate (${(totals.duplicateRate * 100).toFixed(0)}%) — review clustering / near-dupe thresholds.`,
    );
  }
  if (totals.aiCalls >= 40 && totals.aiCacheHitRate < 0.25) {
    insights.push(
      `Elevated AI usage (${totals.aiCalls} calls) with low cache hit rate (${(totals.aiCacheHitRate * 100).toFixed(0)}%).`,
    );
  }
  if (totals.averageBriefingGenerationMs >= 15000) {
    insights.push(
      `Slow briefing generation (avg ${(totals.averageBriefingGenerationMs / 1000).toFixed(1)}s) — check provider latency.`,
    );
  }
  if (totals.apiFailures > 0) {
    insights.push(
      `${totals.apiFailures} news API / provider failure signal(s) in this window.`,
    );
  }
  if (totals.failedAiRequests > 0) {
    insights.push(
      `${totals.failedAiRequests} failed AI request signal(s) — inspect provider errors / retries.`,
    );
  }
  if (totals.jobRunsFailed > 0 || totals.jobTopicsFailed > 0) {
    insights.push(
      `Job health: ${totals.jobRunsFailed} failed job run(s), ${totals.jobTopicsFailed} failed topic(s).`,
    );
  }

  const recent = trends.slice(-3);
  if (recent.length >= 2) {
    const aiTrend = recent.map((day) => day.aiCalls);
    if (aiTrend[aiTrend.length - 1]! > aiTrend[0]! * 1.5 + 5) {
      insights.push("AI calls are trending up over recent days.");
    }
    const durTrend = recent.map((day) => day.averageBriefingGenerationMs);
    if (
      durTrend[durTrend.length - 1]! > 0 &&
      durTrend[0]! > 0 &&
      durTrend[durTrend.length - 1]! > durTrend[0]! * 1.5
    ) {
      insights.push("Briefing generation time is trending slower.");
    }
  }

  const topFail = failedProviders[0];
  if (topFail && topFail.count >= 2) {
    insights.push(
      `Most failing provider: ${topFail.provider} (${topFail.kind}, ${topFail.count} events).`,
    );
  }

  if (insights.length === 0) {
    insights.push("No major pipeline anomalies detected in this window.");
  }
  return insights;
}

/**
 * Pure aggregation over stored briefings, job runs, and analytics events.
 * Keep this module free of React / UI imports.
 */
export function computePipelineAnalytics(options?: {
  days?: number;
  now?: Date;
}): PipelineAnalyticsSnapshot {
  const now = options?.now ?? new Date();
  const days = Math.min(90, Math.max(1, options?.days ?? 14));
  const windowFrom = daysAgoUtc(days, now);
  const windowTo = utcDateString(now);
  const sinceIso = `${windowFrom}T00:00:00.000Z`;

  const briefings = listStoredDailyBriefings({ limit: 500 }).filter(
    (briefing) => briefing.date >= windowFrom && briefing.date <= windowTo,
  );
  const events = listAnalyticsEvents({ sinceIso, limit: 2000 });
  const jobs = listJobRuns(200).filter((job) => {
    const started = job.startedAt.slice(0, 10);
    return started >= windowFrom && started <= windowTo;
  });

  const byDate = new Map<
    string,
    {
      articlesRetrieved: number;
      duplicateArticlesRemoved: number;
      storiesGenerated: number;
      aiCalls: number;
      aiCacheHits: number;
      durations: number[];
      sourceCounts: number[];
      briefingCount: number;
      apiFailures: number;
      failedAiRequests: number;
    }
  >();

  function ensureDay(date: string) {
    let row = byDate.get(date);
    if (!row) {
      row = {
        articlesRetrieved: 0,
        duplicateArticlesRemoved: 0,
        storiesGenerated: 0,
        aiCalls: 0,
        aiCacheHits: 0,
        durations: [],
        sourceCounts: [],
        briefingCount: 0,
        apiFailures: 0,
        failedAiRequests: 0,
      };
      byDate.set(date, row);
    }
    return row;
  }

  // Seed empty days so trends show continuous windows.
  for (let i = 0; i < days; i += 1) {
    const d = new Date(`${windowFrom}T12:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + i);
    ensureDay(utcDateString(d));
  }

  const topicMap = new Map<
    string,
    {
      topic: string;
      articlesRetrieved: number;
      storiesGenerated: number;
      aiCalls: number;
      briefingCount: number;
      sourceCounts: number[];
    }
  >();

  for (const briefing of briefings) {
    const stats = briefing.generationStats;
    const day = ensureDay(briefing.date);
    day.articlesRetrieved += stats.articlesRetrieved;
    day.duplicateArticlesRemoved += stats.duplicateArticlesRemoved;
    day.storiesGenerated += briefing.stories.length;
    day.aiCalls += stats.aiCalls;
    day.aiCacheHits += stats.cachedSummaries;
    day.durations.push(stats.generationDurationMs);
    day.briefingCount += 1;
    day.apiFailures += warningApiFailures(briefing.warnings);
    day.failedAiRequests += warningAiFailures(briefing.warnings);

    for (const story of briefing.stories) {
      day.sourceCounts.push(sourcesForStory(story));
    }

    const topic = topicMap.get(briefing.topic) ?? {
      topic: briefing.topic,
      articlesRetrieved: 0,
      storiesGenerated: 0,
      aiCalls: 0,
      briefingCount: 0,
      sourceCounts: [] as number[],
    };
    topic.articlesRetrieved += stats.articlesRetrieved;
    topic.storiesGenerated += briefing.stories.length;
    topic.aiCalls += stats.aiCalls;
    topic.briefingCount += 1;
    topic.sourceCounts.push(...briefing.stories.map(sourcesForStory));
    topicMap.set(briefing.topic, topic);
  }

  // Overlay durable failure events (prefer event counts when present for a day).
  const eventApiByDate = new Map<string, number>();
  const eventAiByDate = new Map<string, number>();
  for (const event of events) {
    const date = event.createdAt.slice(0, 10);
    if (date < windowFrom || date > windowTo) continue;
    if (event.kind === "news_provider_failure") {
      eventApiByDate.set(date, (eventApiByDate.get(date) ?? 0) + 1);
    }
    if (event.kind === "ai_request_failure") {
      eventAiByDate.set(date, (eventAiByDate.get(date) ?? 0) + 1);
    }
  }
  for (const [date, count] of eventApiByDate) {
    const day = ensureDay(date);
    day.apiFailures = Math.max(day.apiFailures, count);
  }
  for (const [date, count] of eventAiByDate) {
    const day = ensureDay(date);
    day.failedAiRequests = Math.max(day.failedAiRequests, count);
  }

  const trends: PipelineAnalyticsDayTrend[] = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, row]) => {
      const aiDenom = row.aiCalls + row.aiCacheHits;
      return {
        date,
        articlesRetrieved: row.articlesRetrieved,
        duplicateArticlesRemoved: row.duplicateArticlesRemoved,
        duplicateRate: rate(row.duplicateArticlesRemoved, row.articlesRetrieved),
        storiesGenerated: row.storiesGenerated,
        aiCalls: row.aiCalls,
        aiCacheHits: row.aiCacheHits,
        aiCacheHitRate: rate(row.aiCacheHits, aiDenom),
        averageBriefingGenerationMs: average(row.durations),
        averageSourcesPerStory: average(row.sourceCounts),
        apiFailures: row.apiFailures,
        failedAiRequests: row.failedAiRequests,
        briefingCount: row.briefingCount,
      };
    });

  let jobRunsCompleted = 0;
  let jobRunsFailed = 0;
  let jobTopicsFailed = 0;
  for (const job of jobs) {
    if (job.status === "completed") jobRunsCompleted += 1;
    if (job.status === "failed") jobRunsFailed += 1;
    if (job.resultJson) {
      try {
        const result = JSON.parse(job.resultJson) as DailyBriefingJobResult;
        jobTopicsFailed += result.topicsFailed ?? 0;
      } catch {
        // ignore
      }
    }
  }

  const providerCounts = new Map<string, PipelineProviderFailureStat>();
  for (const event of events) {
    if (
      event.kind !== "news_provider_failure" &&
      event.kind !== "ai_request_failure"
    ) {
      continue;
    }
    const provider = event.provider || "unknown";
    const kind = event.kind === "news_provider_failure" ? "news" : "ai";
    const key = `${kind}:${provider}`;
    const existing = providerCounts.get(key);
    if (existing) {
      existing.count += 1;
      existing.lastCode = event.code ?? existing.lastCode;
    } else {
      providerCounts.set(key, {
        provider,
        kind,
        count: 1,
        lastCode: event.code,
      });
    }
  }

  const articlesPerTopic: PipelineTopicStats[] = [...topicMap.values()]
    .map((topic) => ({
      topic: topic.topic,
      articlesRetrieved: topic.articlesRetrieved,
      storiesGenerated: topic.storiesGenerated,
      aiCalls: topic.aiCalls,
      briefingCount: topic.briefingCount,
      averageSourcesPerStory: average(topic.sourceCounts),
    }))
    .sort((a, b) => b.articlesRetrieved - a.articlesRetrieved);
  const mostCoveredTopics = [...articlesPerTopic]
    .sort((a, b) => b.storiesGenerated - a.storiesGenerated)
    .slice(0, 10)
    .map((topic) => ({
      topic: topic.topic,
      storiesGenerated: topic.storiesGenerated,
      briefingCount: topic.briefingCount,
      articlesRetrieved: topic.articlesRetrieved,
    }));

  const totalsArticles = trends.reduce((sum, day) => sum + day.articlesRetrieved, 0);
  const totalsDupes = trends.reduce(
    (sum, day) => sum + day.duplicateArticlesRemoved,
    0,
  );
  const totalsStories = trends.reduce((sum, day) => sum + day.storiesGenerated, 0);
  const totalsAiCalls = trends.reduce((sum, day) => sum + day.aiCalls, 0);
  const totalsCache = trends.reduce((sum, day) => sum + day.aiCacheHits, 0);
  const totalsApiFail = trends.reduce((sum, day) => sum + day.apiFailures, 0);
  const totalsAiFail = trends.reduce((sum, day) => sum + day.failedAiRequests, 0);
  const durationSamples = briefings.map((b) => b.generationStats.generationDurationMs);
  const sourceSamples = briefings.flatMap((b) => b.stories.map(sourcesForStory));

  const base: Omit<PipelineAnalyticsSnapshot, "insights"> = {
    generatedAt: now.toISOString(),
    windowDays: days,
    windowFrom,
    windowTo,
    totals: {
      articlesRetrieved: totalsArticles,
      duplicateArticlesRemoved: totalsDupes,
      duplicateRate: rate(totalsDupes, totalsArticles),
      storiesGenerated: totalsStories,
      averageSourcesPerStory: average(sourceSamples),
      aiCalls: totalsAiCalls,
      aiCacheHits: totalsCache,
      aiCacheHitRate: rate(totalsCache, totalsAiCalls + totalsCache),
      failedAiRequests: totalsAiFail,
      averageBriefingGenerationMs: average(durationSamples),
      apiFailures: totalsApiFail,
      briefingCount: briefings.length,
      jobRunsCompleted,
      jobRunsFailed,
      jobTopicsFailed,
    },
    trends,
    articlesPerTopic,
    mostCoveredTopics,
    failedProviders: [...providerCounts.values()].sort((a, b) => b.count - a.count),
  };

  return {
    ...base,
    insights: buildInsights(base),
  };
}

/** Test helper — expose source counting. */
export function averageSourcesInBriefing(briefing: StoredDailyBriefing): number {
  return average(briefing.stories.map(sourcesForStory));
}
