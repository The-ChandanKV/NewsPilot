import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { briefingCache, summaryCache, topicHistoryCache } from "@/lib/cache/memory";
import * as briefingModule from "@/lib/pipeline/briefing";
import { buildBriefingForTopic } from "@/lib/pipeline/briefing";
import { toDailyBriefingStory } from "@/lib/pipeline/briefing-format";
import { processArticles } from "@/lib/pipeline/process";
import type { LlmCompletionRequest, LlmProvider } from "@/lib/providers/llm/types";
import type { DailyBriefing, SummarizedStory } from "@/types/briefing";
import { makeArticle } from "../helpers/articles";
import { GET } from "@/app/api/briefing/route";

const NOW = new Date("2026-09-12T12:00:00.000Z");
const TOPIC = "artificial-intelligence";

function makeMockProvider(): LlmProvider & { calls: LlmCompletionRequest[] } {
  const calls: LlmCompletionRequest[] = [];
  return {
    name: "gemini",
    calls,
    isConfigured: () => true,
    complete: async (request) => {
      calls.push(request);
      return {
        content: JSON.stringify({
          headline: "AI model launch draws wide coverage",
          summary:
            "Multiple outlets report that OpenAI released a multimodal artificial intelligence model aimed at enterprise use. Coverage is consistent on the launch itself.",
          whyItMatters:
            "Enterprise AI releases can shift vendor competition and adoption timelines.",
          keyFacts: ["OpenAI released a multimodal model", "Enterprise focus reported"],
          entities: ["OpenAI"],
          confidence: "high",
          uncertaintyNotes: [],
          sourceDisagreements: [],
          reportedFacts: ["Reuters reports OpenAI unveiled a multimodal model"],
          inferences: [],
        }),
        model: "mock-gemini",
        provider: "gemini",
      };
    },
  };
}

async function buildProcessed(topic = TOPIC) {
  return await processArticles(
    [
      makeArticle({
        title: "OpenAI unveils multimodal artificial intelligence model",
        url: "https://www.reuters.com/openai-briefing",
        sourceName: "Reuters",
        publishedAt: "2026-09-12T10:00:00.000Z",
        snippet: "OpenAI unveiled a multimodal artificial intelligence model.",
        sourceTier: 1,
      }),
      makeArticle({
        title: "OpenAI launches multimodal artificial intelligence model",
        url: "https://www.bbc.com/openai-briefing",
        sourceName: "BBC",
        publishedAt: "2026-09-12T10:10:00.000Z",
        snippet: "OpenAI launched a multimodal artificial intelligence model.",
        sourceTier: 1,
      }),
      makeArticle({
        title: "Chipmakers expand factories for AI accelerators",
        url: "https://www.reuters.com/chips-briefing",
        sourceName: "Reuters",
        publishedAt: "2026-09-12T08:00:00.000Z",
        snippet: "Chipmakers are expanding factories for AI accelerators.",
        sourceTier: 1,
      }),
    ],
    topic,
    { now: NOW },
  );
}

describe("daily briefing service", () => {
  beforeEach(() => {
    briefingCache.clear();
    summaryCache.clear();
    topicHistoryCache.clear();
  });

  it("returns the public briefing shape with clustered stories", async () => {
    const processed = await buildProcessed();
    const provider = makeMockProvider();

    const briefing = await buildBriefingForTopic(TOPIC, {
      now: NOW,
      provider,
      maxStories: 5,
      processNews: async () => ({
        ...processed,
        normalizedTopic: TOPIC,
        fetchedAt: NOW.toISOString(),
        cached: false,
        providersUsed: ["google_news_rss"],
        providersFailed: [],
      }),
    });

    expect(briefing.topic).toBe(TOPIC);
    expect(briefing.generatedAt).toBeTruthy();
    expect(briefing.timeRange.hours).toBeGreaterThan(0);
    expect(briefing.totalStories).toBe(briefing.stories.length);
    expect(briefing.totalStories).toBeGreaterThan(0);

    const story = briefing.stories[0];
    expect(story.headline).toBeTruthy();
    expect(story.summary).toBeTruthy();
    expect(story.whyItMatters).toBeTruthy();
    expect(Array.isArray(story.keyFacts)).toBe(true);
    expect(story.primarySource).toBeTruthy();
    expect(Array.isArray(story.relatedSources)).toBe(true);
    expect(story.articleUrls.length).toBeGreaterThan(0);
    expect(["high", "medium", "low"]).toContain(story.confidence);
    expect(story.coveredBy).toBeTruthy();
    expect(story.verification).toBeDefined();
    expect(story.verification.explanation).toMatch(/Independent publishers/i);
    expect(story.verification.icon === "check" || story.verification.icon === "warning").toBe(
      true,
    );
    expect(story.change.status).toBe("new");
    expect(briefing.whatsNew).toBeDefined();
    expect(briefing.whatsNew.newCount).toBeGreaterThan(0);
  });

  it("limits stories and consolidates the same event across sources", async () => {
    const processed = await buildProcessed();
    const provider = makeMockProvider();

    const briefing = await buildBriefingForTopic(TOPIC, {
      now: NOW,
      provider,
      maxStories: 1,
      processNews: async () => ({
        ...processed,
        normalizedTopic: TOPIC,
        fetchedAt: NOW.toISOString(),
        cached: false,
        providersUsed: ["google_news_rss"],
        providersFailed: [],
      }),
    });

    expect(briefing.totalStories).toBe(1);
    expect(provider.calls.length).toBe(1);
    expect(briefing.stories[0].articleUrls.length).toBeGreaterThanOrEqual(1);
  });

  it("caches briefings and avoids unnecessary AI calls on repeat", async () => {
    const processed = await buildProcessed();
    const provider = makeMockProvider();
    const processNews = vi.fn(async () => ({
      ...processed,
      normalizedTopic: TOPIC,
      fetchedAt: NOW.toISOString(),
      cached: false,
      providersUsed: ["google_news_rss"] as ["google_news_rss"],
      providersFailed: [],
    }));

    const first = await buildBriefingForTopic(TOPIC, {
      now: NOW,
      provider,
      processNews,
    });
    expect(first.cached).toBe(false);
    expect(first.llmCalls).toBeGreaterThan(0);

    const second = await buildBriefingForTopic(TOPIC, {
      now: NOW,
      provider,
      processNews,
    });
    expect(second.cached).toBe(true);
    expect(processNews).toHaveBeenCalledTimes(1);
    expect(provider.calls.length).toBe(first.llmCalls);
  });

  it("handles partial news-provider failures with warnings", async () => {
    const processed = await buildProcessed();
    const provider = makeMockProvider();

    const briefing = await buildBriefingForTopic(TOPIC, {
      now: NOW,
      provider,
      processNews: async () => ({
        ...processed,
        normalizedTopic: TOPIC,
        fetchedAt: NOW.toISOString(),
        cached: false,
        providersUsed: ["google_news_rss"],
        providersFailed: [
          {
            provider: "newsapi",
            code: "NEWS_PROVIDER_HTTP_ERROR",
            message: "HTTP 500",
          },
        ],
      }),
    });

    expect(briefing.stories.length).toBeGreaterThan(0);
    expect(briefing.warnings.some((warning) => /newsapi/i.test(warning))).toBe(
      true,
    );
  });

  it("maps related sources, URLs, and uncertainty fields", async () => {
    const processed = await buildProcessed();
    const cluster = processed.stories[0];
    const summarized: SummarizedStory = {
      ...cluster,
      ai: {
        headline: "Test headline",
        summary: "Test summary",
        whyItMatters: "Test why",
        keyFacts: ["Fact"],
        entities: ["OpenAI"],
        confidence: "medium",
        uncertaintyNotes: ["Limited detail in snippets"],
        sourceDisagreements: [],
        reportedFacts: ["Fact"],
        inferences: [],
        contentHash: "abc",
        cached: false,
        provider: "gemini",
        isAiGenerated: true,
      },
    };

    const card = toDailyBriefingStory(summarized);
    expect(card.uncertaintyNotes).toContain("Limited detail in snippets");
    expect(card.articleUrls).toContain(cluster.representativeArticle.url);
    expect(card.coveredBy).toContain(cluster.representativeArticle.source);
    expect(card.verification.independentSourceCount).toBe(
      cluster.verification.independentSourceCount,
    );
    expect(card.change.status).toBe("new");
  });

  it("classifies NEW then ONGOING and skips LLM on unchanged stories", async () => {
    const processed = await buildProcessed();
    const provider = makeMockProvider();
    const processNews = async () => ({
      ...processed,
      normalizedTopic: TOPIC,
      fetchedAt: NOW.toISOString(),
      cached: false,
      providersUsed: ["google_news_rss"] as ["google_news_rss"],
      providersFailed: [],
    });

    const first = await buildBriefingForTopic(TOPIC, {
      now: NOW,
      provider,
      processNews,
      forceRefresh: true,
    });

    expect(first.stories.every((story) => story.change.status === "new")).toBe(true);
    expect(first.whatsNew.label).toMatch(/first briefing/i);
    const firstCalls = provider.calls.length;
    expect(firstCalls).toBeGreaterThan(0);

    briefingCache.clear();

    const later = new Date("2026-09-13T12:00:00.000Z");
    const second = await buildBriefingForTopic(TOPIC, {
      now: later,
      provider,
      processNews,
      forceRefresh: true,
    });

    expect(second.stories.every((story) => story.change.status === "ongoing")).toBe(
      true,
    );
    expect(second.whatsNew.label).toBe("What's new since yesterday");
    expect(second.whatsNew.ongoingCount).toBe(second.totalStories);
    expect(second.whatsNew.newCount).toBe(0);
    expect(provider.calls.length).toBe(firstCalls);
    expect(second.summaryCacheHits).toBeGreaterThan(0);
  });

  it("flags UPDATED when the same event gains new coverage", async () => {
    const dayOne = await processArticles(
      [
        makeArticle({
          title: "OpenAI announced model X",
          url: "https://www.reuters.com/openai-x-change",
          sourceName: "Reuters",
          publishedAt: "2026-09-12T10:00:00.000Z",
          snippet: "OpenAI announced model X.",
          sourceTier: 1,
        }),
      ],
      TOPIC,
      { now: NOW },
    );

    const provider = makeMockProvider();
    await buildBriefingForTopic(TOPIC, {
      now: NOW,
      provider,
      forceRefresh: true,
      processNews: async () => ({
        ...dayOne,
        normalizedTopic: TOPIC,
        fetchedAt: NOW.toISOString(),
        cached: false,
        providersUsed: ["google_news_rss"],
        providersFailed: [],
      }),
    });

    briefingCache.clear();

    const dayTwo = await processArticles(
      [
        makeArticle({
          title: "OpenAI announced model X",
          url: "https://www.reuters.com/openai-x-change",
          sourceName: "Reuters",
          publishedAt: "2026-09-12T10:00:00.000Z",
          snippet: "OpenAI announced model X.",
          sourceTier: 1,
        }),
        makeArticle({
          title: "OpenAI released model X to developers",
          url: "https://techcrunch.com/openai-x-dev",
          sourceName: "TechCrunch",
          publishedAt: "2026-09-13T09:00:00.000Z",
          snippet: "OpenAI released model X to developers.",
          sourceTier: 2,
        }),
      ],
      TOPIC,
      { now: new Date("2026-09-13T12:00:00.000Z") },
    );

    const updated = await buildBriefingForTopic(TOPIC, {
      now: new Date("2026-09-13T12:00:00.000Z"),
      provider,
      forceRefresh: true,
      processNews: async () => ({
        ...dayTwo,
        normalizedTopic: TOPIC,
        fetchedAt: "2026-09-13T12:00:00.000Z",
        cached: false,
        providersUsed: ["google_news_rss"],
        providersFailed: [],
      }),
    });

    const story = updated.stories.find((item) =>
      item.articleUrls.some((url) => url.includes("openai-x")),
    );
    expect(story).toBeDefined();
    expect(story!.change.status).toBe("updated");
    expect(story!.change.previousState).not.toBeNull();
    expect(story!.change.changeSummary).toBeTruthy();
    expect(updated.whatsNew.updatedCount).toBeGreaterThan(0);
  });
});

describe("GET /api/briefing", () => {
  beforeEach(() => {
    briefingCache.clear();
    summaryCache.clear();
    vi.restoreAllMocks();
  });

  it("returns 400 when topic is missing", async () => {
    const request = new NextRequest("http://localhost/api/briefing");
    const response = await GET(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("INVALID_TOPIC");
  });

  it("returns 400 for invalid limit", async () => {
    const request = new NextRequest(
      "http://localhost/api/briefing?topic=ai&limit=0",
    );
    const response = await GET(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("INVALID_LIMIT");
  });

  it("returns the daily briefing payload for a valid topic", async () => {
    const mockBriefing: DailyBriefing = {
      topic: TOPIC,
      generatedAt: NOW.toISOString(),
      timeRange: {
        from: "2026-09-10T12:00:00.000Z",
        to: NOW.toISOString(),
        hours: 48,
      },
      totalStories: 1,
      cached: false,
      llmCalls: 1,
      summaryCacheHits: 0,
      providerUsed: "gemini",
      warnings: [],
      stories: [
        {
          id: "story-1",
          headline: "AI model launch draws wide coverage",
          summary: "Outlets report an enterprise multimodal model launch.",
          whyItMatters: "Enterprise AI tooling competition may shift.",
          keyFacts: ["Model launch reported"],
          entities: ["OpenAI"],
          publishedAt: "2026-09-12T10:00:00.000Z",
          primarySource: "Reuters",
          relatedSources: [
            {
              name: "BBC",
              title: "OpenAI launches multimodal model",
              url: "https://www.bbc.com/openai-briefing",
            },
          ],
          articleUrls: [
            "https://www.reuters.com/openai-briefing",
            "https://www.bbc.com/openai-briefing",
          ],
          confidence: "high",
          uncertaintyNotes: [],
          sourceDisagreements: [],
          isAiGenerated: true,
          importanceScore: 0.8,
          coveredBy: "Reuters · BBC",
          verification: {
            level: "confirmed",
            label: "Multiple sources",
            detail: "2 independent sources",
            icon: "check",
            sourceCount: 2,
            independentSourceCount: 2,
            sourceDiversity: 0.5,
            sourceRecency: 0.9,
            sourceQualityScore: 0.95,
            multipleSourcesConfirmEvent: true,
            firstReportedBy: "Reuters",
            signals: [
              "Multiple sources confirm the event",
              "First reported by Reuters",
            ],
            explanation:
              "Independent publishers: 2. Named outlets: 2. Source quality score uses tier weights from config; not a bias rating.",
            publishers: [
              {
                id: "reuters",
                name: "Reuters",
                tier: 1,
                tierLabel: "Widely cited wire / national newsroom",
                qualityScore: 1,
              },
              {
                id: "bbc",
                name: "BBC",
                tier: 1,
                tierLabel: "Widely cited wire / national newsroom",
                qualityScore: 1,
              },
            ],
          },
          change: {
            status: "new",
            stableId: "stable-story-1",
            firstSeenAt: NOW.toISOString(),
            lastUpdatedAt: NOW.toISOString(),
            previousState: null,
            currentState: {
              headline: "AI model launch draws wide coverage",
              summary: "Outlets report an enterprise multimodal model launch.",
              sources: ["Reuters", "BBC"],
              articleUrls: [
                "https://www.reuters.com/openai-briefing",
                "https://www.bbc.com/openai-briefing",
              ],
              publishedAt: "2026-09-12T10:00:00.000Z",
              contentHash: "mockhash",
            },
            changeSummary: "First seen in this briefing",
            materialChange: true,
            matchedPreviousId: null,
          },
        },
      ],
      whatsNew: {
        comparedToGeneratedAt: null,
        label: "What's new (first briefing for this topic)",
        newCount: 1,
        updatedCount: 0,
        ongoingCount: 0,
        highlights: [
          {
            status: "new",
            headline: "AI model launch draws wide coverage",
            changeSummary: "First seen in this briefing",
          },
        ],
      },
    };

    vi.spyOn(briefingModule, "buildBriefingForTopic").mockResolvedValue(
      mockBriefing,
    );

    const request = new NextRequest(
      `http://localhost/api/briefing?topic=${encodeURIComponent(TOPIC)}&limit=5`,
    );
    const response = await GET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.topic).toBe(TOPIC);
    expect(body.generatedAt).toBeTruthy();
    expect(body.timeRange).toEqual(mockBriefing.timeRange);
    expect(body.totalStories).toBe(1);
    expect(body.stories).toHaveLength(1);
    expect(body.stories[0].headline).toBe("AI model launch draws wide coverage");
    expect(body.stories[0].relatedSources).toHaveLength(1);
    expect(body.stories[0].articleUrls).toHaveLength(2);
    expect(body.stories[0].coveredBy).toBe("Reuters · BBC");
    expect(body.stories[0].verification.label).toBe("Multiple sources");
    expect(body.stories[0].verification.independentSourceCount).toBe(2);
    expect(briefingModule.buildBriefingForTopic).toHaveBeenCalledWith(
      TOPIC,
      expect.objectContaining({ maxStories: 5, forceRefresh: false }),
    );
  });
});
