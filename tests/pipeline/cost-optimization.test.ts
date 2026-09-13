import { beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "@/lib/db/migrate";
import { summaryCache } from "@/lib/cache/memory";
import {
  getDurableSummary,
  setDurableSummary,
} from "@/lib/cache/summary-store";
import {
  getRuntimePipelineMetrics,
  resetRuntimePipelineMetricsForTests,
} from "@/lib/metrics/runtime";
import { storyContentHash } from "@/lib/pipeline/summarize-input";
import {
  summarizeStoryCluster,
  summarizeStoryClusters,
} from "@/lib/pipeline/summarize";
import { mapWithConcurrency } from "@/lib/utils/concurrency";
import type { LlmProvider } from "@/lib/providers/llm/types";
import type { StoryCluster, StorySummary } from "@/types/briefing";

function makeCluster(id: string, title: string): StoryCluster {
  const article = {
    id: `a-${id}`,
    title,
    url: `https://www.reuters.com/${id}`,
    source: "Reuters",
    publishedAt: "2026-09-13T10:00:00.000Z",
    author: null,
    description: "OpenAI announced an enterprise model with stronger safety controls.",
    topic: "Artificial Intelligence",
    imageUrl: null,
    provider: "google_news_rss" as const,
  };
  return {
    id,
    headline: title,
    primaryHeadline: title,
    articles: [article],
    sources: ["Reuters"],
    representativeArticle: article,
    relatedArticles: [],
    firstPublishedAt: article.publishedAt,
    latestPublishedAt: article.publishedAt,
    similarityScore: 1,
    articleCount: 1,
    sourceCount: 1,
    scores: {
      relevance: 0.8,
      freshness: 0.8,
      sourceDiversity: 0.2,
      sourceQuality: 1,
      rank: 0.7,
    },
    verification: {
      level: "limited",
      label: "Limited",
      detail: "test",
      icon: "warning",
      sourceCount: 1,
      independentSourceCount: 1,
      sourceDiversity: 0.2,
      sourceRecency: 0.9,
      sourceQualityScore: 1,
      multipleSourcesConfirmEvent: false,
      firstReportedBy: "Reuters",
      signals: [],
      explanation: "test",
      publishers: [],
    },
  };
}

function mockProvider(complete: LlmProvider["complete"]): LlmProvider {
  return {
    name: "gemini",
    isConfigured: () => true,
    complete,
  };
}

describe("AI cost / performance optimization", () => {
  beforeEach(() => {
    migrate();
    summaryCache.clear();
    resetRuntimePipelineMetricsForTests();
  });

  it("does not call AI when a memory-cached summary exists", async () => {
    const cluster = makeCluster("c1", "OpenAI enterprise model");
    const complete = vi.fn(async () => ({
      content: JSON.stringify({
        headline: "OpenAI launches enterprise model",
        summary: "OpenAI announced an enterprise model.",
        whyItMatters: "Enterprises may reassess vendors.",
        keyFacts: ["Enterprise model announced"],
        entities: ["OpenAI"],
        confidence: "high",
        uncertaintyNotes: [],
        sourceDisagreements: [],
        reportedFacts: ["Enterprise model announced"],
        inferences: [],
      }),
      model: "test-model",
      provider: "gemini" as const,
    }));
    const provider = mockProvider(complete);

    const first = await summarizeStoryCluster(cluster, "AI", { provider });
    expect(first.isAiGenerated).toBe(true);
    expect(complete).toHaveBeenCalledTimes(1);

    const second = await summarizeStoryCluster(cluster, "AI", {
      provider,
      forceRefresh: true, // deprecated; must not bypass AI cache by itself
      forceAiRefresh: false,
    });
    expect(second.cached).toBe(true);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("never calls AI when forceAiRefresh is false and durable cache has the hash", async () => {
    const cluster = makeCluster("c2", "OpenAI enterprise durable");
    const hash = storyContentHash(cluster, "AI", 6);
    const stored: StorySummary = {
      headline: "Cached headline",
      summary: "OpenAI announced an enterprise model.",
      whyItMatters: "Vendor impact",
      keyFacts: ["Announced"],
      entities: ["OpenAI"],
      confidence: "high",
      uncertaintyNotes: [],
      sourceDisagreements: [],
      reportedFacts: ["Announced"],
      inferences: [],
      contentHash: hash,
      cached: true,
      provider: "gemini",
      isAiGenerated: true,
    };
    setDurableSummary({
      provider: "gemini",
      contentHash: hash,
      summary: stored,
      ttlSeconds: 3600,
    });
    expect(getDurableSummary("gemini", hash)?.headline).toBe("Cached headline");

    const complete = vi.fn(async () => {
      throw new Error("should not be called");
    });
    const result = await summarizeStoryCluster(cluster, "AI", {
      provider: mockProvider(complete),
      forceAiRefresh: false,
    });
    expect(result.cached).toBe(true);
    expect(result.headline).toBe("Cached headline");
    expect(complete).not.toHaveBeenCalled();
  });

  it("dedupes concurrent AI calls for the same content hash", async () => {
    let resolveComplete!: (value: {
      content: string;
      model: string;
      provider: "gemini";
    }) => void;
    const gate = new Promise<{
      content: string;
      model: string;
      provider: "gemini";
    }>((resolve) => {
      resolveComplete = resolve;
    });
    const complete = vi.fn(() => gate);
    const provider = mockProvider(complete);
    const cluster = makeCluster("c3", "Concurrent OpenAI story");

    const p1 = summarizeStoryCluster(cluster, "AI", { provider });
    const p2 = summarizeStoryCluster(cluster, "AI", { provider });

    resolveComplete({
      content: JSON.stringify({
        headline: "Concurrent summary",
        summary: "OpenAI announced an enterprise model.",
        whyItMatters: "Impact",
        keyFacts: ["Announced"],
        entities: ["OpenAI"],
        confidence: "medium",
        uncertaintyNotes: [],
        sourceDisagreements: [],
        reportedFacts: ["Announced"],
        inferences: [],
      }),
      model: "test",
      provider: "gemini",
    });

    const [a, b] = await Promise.all([p1, p2]);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(a.headline).toBe("Concurrent summary");
    expect(b.headline).toBe("Concurrent summary");
    expect(b.cached).toBe(true);
  });

  it("limits concurrency with mapWithConcurrency", async () => {
    let active = 0;
    let maxActive = 0;
    const results = await mapWithConcurrency([1, 2, 3, 4], 2, async (n) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 20));
      active -= 1;
      return n * 2;
    });
    expect(results).toEqual([2, 4, 6, 8]);
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it("records runtime metrics for cache hits", async () => {
    const cluster = makeCluster("c4", "Metrics OpenAI story");
    const complete = vi.fn(async () => ({
      content: JSON.stringify({
        headline: "Metrics headline",
        summary: "OpenAI announced an enterprise model.",
        whyItMatters: "Impact",
        keyFacts: ["Announced"],
        entities: ["OpenAI"],
        confidence: "high",
        uncertaintyNotes: [],
        sourceDisagreements: [],
        reportedFacts: ["Announced"],
        inferences: [],
      }),
      model: "test",
      provider: "gemini" as const,
    }));
    const provider = mockProvider(complete);
    await summarizeStoryClusters([cluster], "AI", { provider });
    await summarizeStoryClusters([cluster], "AI", { provider });
    const metrics = getRuntimePipelineMetrics();
    expect(metrics.aiCalls).toBeGreaterThanOrEqual(1);
    expect(metrics.summaryCacheHits).toBeGreaterThanOrEqual(1);
  });
});
