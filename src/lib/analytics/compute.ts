import { desc } from "drizzle-orm";
import { listAnalyticsEvents } from "@/lib/analytics/events";
import type {
  DevelopmentPipelineMetrics,
  PipelineAnalyticsAlert,
  PipelineAnalyticsDayTrend,
  PipelineAnalyticsSnapshot,
  PipelineProviderFailureStat,
  PipelineTopicStats,
} from "@/lib/analytics/types";
import { getMemoryCacheSnapshot } from "@/lib/cache/memory";
import { countDurableSummaries } from "@/lib/cache/summary-store";
import { getDb } from "@/lib/db/client";
import { jobRuns } from "@/lib/db/schema";
import { listStoredDailyBriefings } from "@/lib/jobs/daily-briefing-store";
import type {
  DailyBriefingJobResult,
  StoredDailyBriefing,
} from "@/lib/jobs/types";
import { getRuntimePipelineMetrics } from "@/lib/metrics/runtime";
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

function buildDevelopmentMetrics(): DevelopmentPipelineMetrics {
  const runtime = getRuntimePipelineMetrics();
  const caches = getMemoryCacheSnapshot();
  return {
    aiCalls: runtime.aiCalls,
    cacheHits: runtime.cacheHits,
    articlesProcessed: runtime.articlesProcessed,
    duplicateArticlesRemoved: runtime.duplicateArticlesRemoved,
    storiesGenerated: runtime.storiesGenerated,
    averageProcessingTimeMs: runtime.averageProcessingTimeMs,
    briefingRuns: runtime.briefingRuns,
    summaryCacheHits: runtime.summaryCacheHits,
    newsCacheHits: runtime.newsCacheHits,
    briefingCacheHits: runtime.briefingCacheHits,
    durableSummaryHits: runtime.durableSummaryHits,
    durableSummariesStored: countDurableSummaries(),
    aiDedupedCalls: runtime.aiDedupedCalls,
    memoryCaches: {
      news: {
        hits: caches.news.hits,
        misses: caches.news.misses,
        hitRate: caches.news.hitRate,
        size: caches.news.size,
      },
      summary: {
        hits: caches.summary.hits,
        misses: caches.summary.misses,
        hitRate: caches.summary.hitRate,
        size: caches.summary.size,
      },
      briefing: {
        hits: caches.briefing.hits,
        misses: caches.briefing.misses,
        hitRate: caches.briefing.hitRate,
        size: caches.briefing.size,
      },
    },
    recentRuns: runtime.recentRuns,
  };
}

/**
 * Derive operational alerts used to spot cost / reliability issues.
 * Pure function — safe to unit test without UI.
 */
export function buildOperationalAlerts(
  snapshot: Omit<PipelineAnalyticsSnapshot, "insights" | "alerts" | "developmentMetrics">,
): PipelineAnalyticsAlert[] {
  const alerts: PipelineAnalyticsAlert[] = [];
  const { totals, trends, failedProviders } = snapshot;
  const recent = trends.slice(-3);
  const articlesPerDay = totals.articlesRetrieved / Math.max(1, snapshot.windowDays);
  const apiFailRate = totals.apiFailures / Math.max(1, totals.briefingCount);

  if (totals.apiFailures >= 3 || apiFailRate >= 0.5) {
    alerts.push({
      kind: "excessive_api_usage",
      severity: totals.apiFailures >= 8 ? "critical" : "warning",
      title: "Excessive or failing news API usage",
      detail: `${totals.apiFailures} API/provider failure signal(s) across ${totals.briefingCount} briefing(s); ~${articlesPerDay.toFixed(0)} articles/day retrieved.`,
      metric: "apiFailures",
      value: totals.apiFailures,
    });
  } else if (articlesPerDay >= 80) {
    alerts.push({
      kind: "excessive_api_usage",
      severity: "info",
      title: "High article retrieval volume",
      detail: `Averaging ~${articlesPerDay.toFixed(0)} articles/day — watch provider quotas.`,
      metric: "articlesRetrieved",
      value: totals.articlesRetrieved,
    });
  }

  if (totals.aiCalls >= 40 && totals.aiCacheHitRate < 0.25) {
    alerts.push({
      kind: "excessive_ai_calls",
      severity: totals.aiCalls >= 80 ? "critical" : "warning",
      title: "Excessive AI calls",
      detail: `${totals.aiCalls} AI calls with ${(totals.aiCacheHitRate * 100).toFixed(0)}% cache hit rate.`,
      metric: "aiCalls",
      value: totals.aiCalls,
    });
  } else if (recent.length >= 2) {
    const first = recent[0]!.aiCalls;
    const last = recent[recent.length - 1]!.aiCalls;
    if (last > first * 1.5 + 5) {
      alerts.push({
        kind: "excessive_ai_calls",
        severity: "info",
        title: "AI calls trending up",
        detail: `Recent daily AI calls rose from ${first} to ${last}.`,
        metric: "aiCalls",
        value: last,
      });
    }
  }

  if (totals.duplicateRate >= 0.45) {
    alerts.push({
      kind: "duplicate_news",
      severity: totals.duplicateRate >= 0.65 ? "critical" : "warning",
      title: "High duplicate news rate",
      detail: `${(totals.duplicateRate * 100).toFixed(0)}% of retrieved articles removed as duplicates (${totals.duplicateArticlesRemoved}/${totals.articlesRetrieved}).`,
      metric: "duplicateRate",
      value: totals.duplicateRate,
    });
  }

  if (totals.averageBriefingGenerationMs >= 15000) {
    alerts.push({
      kind: "slow_processing",
      severity:
        totals.averageBriefingGenerationMs >= 30000 ? "critical" : "warning",
      title: "Slow briefing generation",
      detail: `Average generation time ${(totals.averageBriefingGenerationMs / 1000).toFixed(1)}s.`,
      metric: "averageBriefingGenerationMs",
      value: totals.averageBriefingGenerationMs,
    });
  } else if (recent.length >= 2) {
    const first = recent[0]!.averageBriefingGenerationMs;
    const last = recent[recent.length - 1]!.averageBriefingGenerationMs;
    if (first > 0 && last > first * 1.5) {
      alerts.push({
        kind: "slow_processing",
        severity: "info",
        title: "Processing time trending slower",
        detail: `Avg generation ms rose from ${Math.round(first)} to ${Math.round(last)}.`,
        metric: "averageBriefingGenerationMs",
        value: last,
      });
    }
  }

  const failureCount =
    failedProviders.reduce((sum, row) => sum + row.count, 0) +
    totals.failedAiRequests +
    totals.jobRunsFailed;
  if (failureCount > 0 || failedProviders.length > 0) {
    const top = failedProviders[0];
    alerts.push({
      kind: "failed_providers",
      severity:
        failureCount >= 5 || totals.jobRunsFailed > 0 ? "critical" : "warning",
      title: "Failed providers / jobs",
      detail: top
        ? `Top failure: ${top.provider} (${top.kind}, ${top.count}). AI request failures: ${totals.failedAiRequests}. Failed jobs: ${totals.jobRunsFailed}.`
        : `${totals.failedAiRequests} AI failure(s), ${totals.jobRunsFailed} failed job run(s).`,
      metric: "failedProviders",
      value: failureCount,
    });
  }

  return alerts;
}

function buildInsights(
  snapshot: Omit<PipelineAnalyticsSnapshot, "insights">,
): string[] {
  if (snapshot.alerts.length === 0) {
    return ["No major pipeline anomalies detected in this window."];
  }
  return snapshot.alerts.map(
    (alert) => `[${alert.severity}] ${alert.title}: ${alert.detail}`,
  );
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

  const base: Omit<
    PipelineAnalyticsSnapshot,
    "insights" | "alerts" | "developmentMetrics"
  > = {
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

  const alerts = buildOperationalAlerts(base);
  const developmentMetrics = buildDevelopmentMetrics();
  const withAlerts = { ...base, alerts, developmentMetrics };

  return {
    ...withAlerts,
    insights: buildInsights(withAlerts),
  };
}

/** Test helper — expose source counting. */
export function averageSourcesInBriefing(briefing: StoredDailyBriefing): number {
  return average(briefing.stories.map(sourcesForStory));
}
