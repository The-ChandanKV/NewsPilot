import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { resetEnvForTests } from "@/config/env";
import { resetDbConnectionForTests } from "@/lib/db/client";
import { migrate } from "@/lib/db/migrate";
import {
  getStoredDailyBriefing,
  listStoredDailyBriefings,
} from "@/lib/jobs/daily-briefing-store";
import {
  briefingDateForNow,
  generateDailyBriefingForTopic,
  runDailyBriefingsJob,
} from "@/lib/jobs/daily-briefings";
import { addUserTopic } from "@/lib/topics/store";
import type { DailyBriefing } from "@/types/briefing";

const NOW = new Date("2026-09-13T12:00:00.000Z");

function makeBriefing(topic: string): DailyBriefing {
  return {
    topic,
    generatedAt: NOW.toISOString(),
    timeRange: {
      from: "2026-09-11T12:00:00.000Z",
      to: NOW.toISOString(),
      hours: 48,
    },
    totalStories: 1,
    cached: false,
    llmCalls: 1,
    summaryCacheHits: 2,
    providerUsed: "gemini",
    warnings: [],
    whatsNew: {
      comparedToGeneratedAt: null,
      label: "What's new (first briefing for this topic)",
      newCount: 1,
      updatedCount: 0,
      ongoingCount: 0,
      highlights: [
        {
          status: "new",
          headline: `${topic} development`,
          changeSummary: "First seen in this briefing",
        },
      ],
    },
    stories: [
      {
        id: `${topic}-story`,
        headline: `${topic} development`,
        summary: `Summary for ${topic}`,
        whyItMatters: `${topic} matters for the industry.`,
        keyFacts: ["Fact"],
        entities: [],
        publishedAt: "2026-09-13T09:00:00.000Z",
        primarySource: "Reuters",
        relatedSources: [],
        articleUrls: [`https://www.reuters.com/${encodeURIComponent(topic)}`],
        confidence: "high",
        uncertaintyNotes: [],
        sourceDisagreements: [],
        isAiGenerated: true,
        importanceScore: 0.8,
        coveredBy: "Reuters",
        verification: {
          level: "limited",
          label: "Limited reporting",
          detail: "Only one source currently available",
          icon: "warning",
          sourceCount: 1,
          independentSourceCount: 1,
          sourceDiversity: 0.2,
          sourceRecency: 0.9,
          sourceQualityScore: 1,
          multipleSourcesConfirmEvent: false,
          firstReportedBy: "Reuters",
          signals: ["Currently reported by a single source"],
          explanation: "test",
          publishers: [],
        },
        change: {
          status: "new",
          stableId: "stable-1",
          firstSeenAt: NOW.toISOString(),
          lastUpdatedAt: NOW.toISOString(),
          previousState: null,
          currentState: {
            headline: `${topic} development`,
            summary: `Summary for ${topic}`,
            sources: ["Reuters"],
            articleUrls: [`https://www.reuters.com/${encodeURIComponent(topic)}`],
            publishedAt: "2026-09-13T09:00:00.000Z",
            contentHash: "hash",
          },
          changeSummary: "First seen in this briefing",
          materialChange: true,
          matchedPreviousId: null,
        },
      },
    ],
  };
}

describe("automatic daily briefings", () => {
  beforeEach(() => {
    const dbPath = path.join(
      os.tmpdir(),
      `newspilot-daily-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
    );
    process.env.DATABASE_URL = dbPath;
    process.env.DAILY_BRIEFING_TIMEZONE = "UTC";
    process.env.DAILY_BRIEFING_FREQUENCIES = "daily,twice_daily";
    resetEnvForTests();
    resetDbConnectionForTests();
    migrate();
  });

  it("stores a daily briefing entity with generation stats", async () => {
    const date = briefingDateForNow(NOW, "UTC");
    const processNews = vi.fn(async (topic: string) => ({
      topic,
      processedAt: NOW.toISOString(),
      inputCount: 4,
      afterUrlDedupe: 3,
      afterNearDedupe: 3,
      storyCount: 2,
      stories: [],
      dedupeStats: {
        inputCount: 4,
        afterNormalization: 4,
        exactUrlDuplicatesRemoved: 1,
        nearDuplicatesRemoved: 0,
        afterDedupe: 3,
        clusterCount: 2,
        duplicateArticlesCollapsed: 1,
        compressionRatio: 0.5,
      },
      normalizedTopic: topic,
      fetchedAt: NOW.toISOString(),
      cached: false,
      providersUsed: ["google_news_rss"] as ["google_news_rss"],
      providersFailed: [],
    }));
    const buildBriefing = vi.fn(async (topic: string, options?: { processNews?: typeof processNews }) => {
      if (options?.processNews) {
        await options.processNews(topic, { forceRefresh: true, now: NOW });
      }
      return makeBriefing(topic);
    });

    const { briefing, created } = await generateDailyBriefingForTopic(
      "Artificial Intelligence",
      date,
      { now: NOW, buildBriefing, processNews },
    );

    expect(created).toBe(true);
    expect(briefing.topic).toBe("Artificial Intelligence");
    expect(briefing.date).toBe(date);
    expect(briefing.stories).toHaveLength(1);
    expect(briefing.changes.newCount).toBe(1);
    expect(briefing.generationStats.articlesRetrieved).toBe(4);
    expect(briefing.generationStats.duplicateArticlesRemoved).toBe(2);
    expect(briefing.generationStats.storyClustersCreated).toBe(2);
    expect(briefing.generationStats.aiCalls).toBe(1);
    expect(briefing.generationStats.cachedSummaries).toBe(2);
    expect(briefing.topDevelopments[0]).toContain("Artificial Intelligence");
    expect(buildBriefing).toHaveBeenCalledTimes(1);
  });

  it("is idempotent for the same topic and date", async () => {
    const date = briefingDateForNow(NOW, "UTC");
    const buildBriefing = vi.fn(async (topic: string) => makeBriefing(topic));
    const processNews = vi.fn(async (topic: string) => ({
      topic,
      processedAt: NOW.toISOString(),
      inputCount: 1,
      afterUrlDedupe: 1,
      afterNearDedupe: 1,
      storyCount: 1,
      stories: [],
      dedupeStats: {
        inputCount: 1,
        afterNormalization: 1,
        exactUrlDuplicatesRemoved: 0,
        nearDuplicatesRemoved: 0,
        afterDedupe: 1,
        clusterCount: 1,
        duplicateArticlesCollapsed: 0,
        compressionRatio: 1,
      },
      normalizedTopic: topic,
      fetchedAt: NOW.toISOString(),
      cached: false,
      providersUsed: ["google_news_rss"] as ["google_news_rss"],
      providersFailed: [],
    }));

    const first = await generateDailyBriefingForTopic("Space", date, {
      now: NOW,
      buildBriefing,
      processNews,
    });
    const second = await generateDailyBriefingForTopic("Space", date, {
      now: NOW,
      buildBriefing,
      processNews,
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.briefing.id).toBe(first.briefing.id);
    expect(buildBriefing).toHaveBeenCalledTimes(1);
    expect(getStoredDailyBriefing("Space", date)?.id).toBe(first.briefing.id);
  });

  it("skips duplicate job runs for the same date", async () => {
    addUserTopic("client-a", { topic: "Cybersecurity", frequency: "daily" });
    const date = briefingDateForNow(NOW, "UTC");
    const buildBriefing = vi.fn(async (topic: string) => makeBriefing(topic));
    const processNews = vi.fn(async (topic: string) => ({
      topic,
      processedAt: NOW.toISOString(),
      inputCount: 2,
      afterUrlDedupe: 2,
      afterNearDedupe: 2,
      storyCount: 1,
      stories: [],
      dedupeStats: {
        inputCount: 2,
        afterNormalization: 2,
        exactUrlDuplicatesRemoved: 0,
        nearDuplicatesRemoved: 0,
        afterDedupe: 2,
        clusterCount: 1,
        duplicateArticlesCollapsed: 1,
        compressionRatio: 0.5,
      },
      normalizedTopic: topic,
      fetchedAt: NOW.toISOString(),
      cached: false,
      providersUsed: ["google_news_rss"] as ["google_news_rss"],
      providersFailed: [],
    }));

    const first = await runDailyBriefingsJob({
      date,
      now: NOW,
      buildBriefing,
      processNews,
    });
    const second = await runDailyBriefingsJob({
      date,
      now: NOW,
      buildBriefing,
      processNews,
    });

    expect(first.status).toBe("completed");
    expect(first.topicsCreated).toBe(1);
    expect(second.status).toBe("skipped_duplicate_job");
    expect(listStoredDailyBriefings({ date })).toHaveLength(1);

    fs.rmSync(process.env.DATABASE_URL!, { force: true });
  });
});
