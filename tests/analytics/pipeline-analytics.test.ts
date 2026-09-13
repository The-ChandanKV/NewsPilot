import { beforeEach, describe, expect, it } from "vitest";
import os from "os";
import path from "path";
import { resetEnvForTests } from "@/config/env";
import {
  computePipelineAnalytics,
  averageSourcesInBriefing,
  buildOperationalAlerts,
} from "@/lib/analytics/compute";
import {
  recordAnalyticsEvent,
  sanitizeAnalyticsDetail,
} from "@/lib/analytics/events";
import { resetDbConnectionForTests } from "@/lib/db/client";
import { migrate } from "@/lib/db/migrate";
import { saveStoredDailyBriefing } from "@/lib/jobs/daily-briefing-store";
import type { StoredDailyBriefing } from "@/lib/jobs/types";

function makeBriefing(
  topic: string,
  date: string,
  stats: Partial<StoredDailyBriefing["generationStats"]> & {
    stories?: number;
    sourcesPerStory?: number;
    warnings?: string[];
  } = {},
): Omit<StoredDailyBriefing, "id"> {
  const storyCount = stats.stories ?? 2;
  const sourcesPerStory = stats.sourcesPerStory ?? 2;
  return {
    topic,
    date,
    generatedAt: `${date}T06:00:00.000Z`,
    stories: Array.from({ length: storyCount }, (_, index) => ({
      id: `${topic}-${index}`,
      headline: `${topic} story ${index}`,
      summary: "summary",
      whyItMatters: "matters",
      keyFacts: [],
      entities: [],
      publishedAt: `${date}T05:00:00.000Z`,
      primarySource: "Reuters",
      relatedSources:
        sourcesPerStory > 1
          ? [
              {
                name: "The Verge",
                title: "related",
                url: `https://example.com/${topic}-${index}-b`,
              },
            ]
          : [],
      articleUrls: [
        `https://example.com/${topic}-${index}`,
        ...(sourcesPerStory > 1
          ? [`https://example.com/${topic}-${index}-b`]
          : []),
      ],
      confidence: "medium" as const,
      uncertaintyNotes: [],
      sourceDisagreements: [],
      isAiGenerated: true,
      importanceScore: 0.5,
      coveredBy: sourcesPerStory > 1 ? "Reuters · The Verge" : "Reuters",
      verification: {
        level: "confirmed" as const,
        label: "Multiple sources",
        detail: "test",
        icon: "check" as const,
        sourceCount: sourcesPerStory,
        independentSourceCount: sourcesPerStory,
        sourceDiversity: 0.5,
        sourceRecency: 0.9,
        sourceQualityScore: 1,
        multipleSourcesConfirmEvent: sourcesPerStory > 1,
        firstReportedBy: "Reuters",
        signals: [],
        explanation: "test",
        publishers: [],
      },
      change: {
        status: "new" as const,
        stableId: `${topic}-${index}`,
        firstSeenAt: `${date}T06:00:00.000Z`,
        lastUpdatedAt: `${date}T06:00:00.000Z`,
        previousState: null,
        currentState: {
          headline: `${topic} story ${index}`,
          summary: "summary",
          sources: ["Reuters"],
          articleUrls: [`https://example.com/${topic}-${index}`],
          publishedAt: `${date}T05:00:00.000Z`,
          contentHash: "h",
        },
        changeSummary: null,
        materialChange: false,
        matchedPreviousId: null,
      },
    })),
    changes: {
      comparedToGeneratedAt: null,
      label: "What's new",
      newCount: storyCount,
      updatedCount: 0,
      ongoingCount: 0,
      highlights: [],
    },
    generationStats: {
      articlesRetrieved: stats.articlesRetrieved ?? 20,
      duplicateArticlesRemoved: stats.duplicateArticlesRemoved ?? 8,
      storyClustersCreated: stats.storyClustersCreated ?? storyCount,
      aiCalls: stats.aiCalls ?? 3,
      cachedSummaries: stats.cachedSummaries ?? 1,
      generationDurationMs: stats.generationDurationMs ?? 4000,
    },
    warnings: stats.warnings ?? [],
    topDevelopments: [],
    whyItMatters: [],
  };
}

describe("pipeline analytics", () => {
  beforeEach(() => {
    const dbPath = path.join(
      os.tmpdir(),
      `newspilot-analytics-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
    );
    process.env.DATABASE_URL = dbPath;
    resetEnvForTests();
    resetDbConnectionForTests();
    migrate();
  });

  it("redacts secret-looking analytics detail", () => {
    expect(
      sanitizeAnalyticsDetail("Authorization Bearer sk-abcdefghijklmnopqrstuvwxyz"),
    ).toContain("[redacted]");
    expect(sanitizeAnalyticsDetail("api_key=supersecretvalue123456")).toContain(
      "[redacted]",
    );
  });

  it("aggregates briefing stats, topics, trends, and failure events", () => {
    saveStoredDailyBriefing(
      makeBriefing("AI", "2026-09-12", {
        articlesRetrieved: 30,
        duplicateArticlesRemoved: 10,
        aiCalls: 4,
        cachedSummaries: 2,
        generationDurationMs: 5000,
        stories: 3,
        sourcesPerStory: 3,
      }),
    );
    saveStoredDailyBriefing(
      makeBriefing("Space", "2026-09-13", {
        articlesRetrieved: 10,
        duplicateArticlesRemoved: 2,
        aiCalls: 1,
        cachedSummaries: 0,
        generationDurationMs: 2000,
        stories: 1,
        sourcesPerStory: 2,
        warnings: ["News provider google_news_rss failed"],
      }),
    );

    recordAnalyticsEvent({
      kind: "news_provider_failure",
      provider: "newsapi",
      code: "NEWS_RATE_LIMITED",
      detail: "rate limited",
      createdAt: "2026-09-13T08:00:00.000Z",
    });
    recordAnalyticsEvent({
      kind: "ai_request_failure",
      provider: "gemini",
      code: "AI_PROVIDER_TIMEOUT",
      detail: "timeout",
      createdAt: "2026-09-13T09:00:00.000Z",
    });

    const snapshot = computePipelineAnalytics({
      days: 2,
      now: new Date("2026-09-13T12:00:00.000Z"),
    });

    expect(snapshot.totals.articlesRetrieved).toBe(40);
    expect(snapshot.totals.duplicateArticlesRemoved).toBe(12);
    expect(snapshot.totals.duplicateRate).toBeCloseTo(0.3);
    expect(snapshot.totals.storiesGenerated).toBe(4);
    expect(snapshot.totals.aiCalls).toBe(5);
    expect(snapshot.totals.aiCacheHits).toBe(2);
    expect(snapshot.totals.aiCacheHitRate).toBeCloseTo(2 / 7);
    expect(snapshot.totals.averageBriefingGenerationMs).toBe(3500);
    expect(snapshot.totals.averageSourcesPerStory).toBeGreaterThan(2);
    expect(snapshot.totals.apiFailures).toBeGreaterThanOrEqual(1);
    expect(snapshot.totals.failedAiRequests).toBeGreaterThanOrEqual(1);
    expect(snapshot.articlesPerTopic[0]?.topic).toBe("AI");
    expect(snapshot.mostCoveredTopics[0]?.topic).toBe("AI");
    expect(snapshot.trends).toHaveLength(2);
    expect(snapshot.failedProviders.some((p) => p.provider === "newsapi")).toBe(
      true,
    );
    expect(snapshot.insights.length).toBeGreaterThan(0);
    expect(snapshot.alerts.some((alert) => alert.kind === "failed_providers")).toBe(
      true,
    );
    expect(snapshot.developmentMetrics).toBeDefined();
    expect(snapshot.developmentMetrics.aiCalls).toBeGreaterThanOrEqual(0);
    expect(snapshot.developmentMetrics).toHaveProperty("cacheHits");
    expect(snapshot.developmentMetrics).toHaveProperty("articlesProcessed");
    expect(snapshot.developmentMetrics).toHaveProperty(
      "duplicateArticlesRemoved",
    );
    expect(snapshot.developmentMetrics).toHaveProperty("storiesGenerated");
    expect(snapshot.developmentMetrics).toHaveProperty(
      "averageProcessingTimeMs",
    );
    expect(JSON.stringify(snapshot)).not.toMatch(/api_key|sk-/i);
  });

  it("builds structured alerts for duplicate / AI / slow / API issues", () => {
    const alerts = buildOperationalAlerts({
      generatedAt: new Date().toISOString(),
      windowDays: 7,
      windowFrom: "2026-09-07",
      windowTo: "2026-09-13",
      totals: {
        articlesRetrieved: 100,
        duplicateArticlesRemoved: 55,
        duplicateRate: 0.55,
        storiesGenerated: 10,
        averageSourcesPerStory: 2,
        aiCalls: 50,
        aiCacheHits: 5,
        aiCacheHitRate: 0.09,
        failedAiRequests: 2,
        averageBriefingGenerationMs: 18000,
        apiFailures: 4,
        briefingCount: 5,
        jobRunsCompleted: 4,
        jobRunsFailed: 1,
        jobTopicsFailed: 1,
      },
      trends: [],
      articlesPerTopic: [],
      mostCoveredTopics: [],
      failedProviders: [
        { provider: "newsapi", kind: "news", count: 3, lastCode: "NEWS_RATE_LIMITED" },
      ],
    });

    const kinds = alerts.map((alert) => alert.kind);
    expect(kinds).toContain("duplicate_news");
    expect(kinds).toContain("excessive_ai_calls");
    expect(kinds).toContain("slow_processing");
    expect(kinds).toContain("excessive_api_usage");
    expect(kinds).toContain("failed_providers");
  });

  it("computes average sources from stored stories", () => {
    const stored = saveStoredDailyBriefing(
      makeBriefing("Cyber", "2026-09-13", { stories: 2, sourcesPerStory: 2 }),
    );
    expect(averageSourcesInBriefing(stored)).toBe(2);
  });
});
