import { beforeEach, describe, expect, it } from "vitest";
import { summaryCache } from "@/lib/cache/memory";
import { processArticles } from "@/lib/pipeline/process";
import {
  parseStorySummaryJson,
} from "@/lib/pipeline/summary-schema";
import {
  buildSummarizationInput,
  storyContentHash,
} from "@/lib/pipeline/summarize-input";
import { summarizeStoryClusters } from "@/lib/pipeline/summarize";
import type { LlmCompletionRequest, LlmProvider } from "@/lib/providers/llm/types";
import { makeArticle } from "../helpers/articles";

const NOW = new Date("2026-09-12T12:00:00.000Z");
const TOPIC = "Artificial Intelligence";

function makeMockProvider(completeImpl?: LlmProvider["complete"]): LlmProvider & {
  calls: LlmCompletionRequest[];
} {
  const calls: LlmCompletionRequest[] = [];
  return {
    name: "gemini",
    calls,
    isConfigured: () => true,
    complete: async (request) => {
      calls.push(request);
      if (completeImpl) {
        return completeImpl(request);
      }
      return {
        content: JSON.stringify({
          headline: "OpenAI releases multimodal model",
          summary:
            "OpenAI released a multimodal artificial intelligence model, according to Reuters and BBC. The reports describe an enterprise-focused system. Independent coverage aligns on the launch itself.",
          whyItMatters:
            "Enterprise AI tooling changes can affect adoption and competition among cloud providers.",
          keyFacts: [
            "OpenAI released a multimodal model",
            "Coverage frames the release as enterprise-focused",
          ],
          entities: ["OpenAI", "Reuters", "BBC"],
          confidence: "high",
          uncertaintyNotes: [],
          sourceDisagreements: [],
          reportedFacts: [
            "Reuters reports OpenAI unveiled a multimodal artificial intelligence model",
            "BBC reports OpenAI launched a multimodal model",
          ],
          inferences: [],
        }),
        model: "mock-gemini",
        provider: "gemini",
        usage: { inputTokens: 100, outputTokens: 80 },
      };
    },
  };
}

describe("AI summarization layer", () => {
  beforeEach(() => {
    summaryCache.clear();
  });

  it("validates structured summary JSON and rejects malformed payloads", async () => {
    const valid = parseStorySummaryJson(
      JSON.stringify({
        headline: "Test",
        summary: "A factual summary with enough detail.",
        whyItMatters: "Context for readers.",
        keyFacts: ["Fact one"],
        entities: ["Entity"],
        confidence: "medium",
        uncertaintyNotes: [],
        sourceDisagreements: [],
        reportedFacts: ["Source reports fact one"],
        inferences: [],
      }),
    );
    expect(valid.headline).toBe("Test");

    expect(() => parseStorySummaryJson("{not-json")).toThrow(/Malformed JSON/i);
    expect(() =>
      parseStorySummaryJson(
        JSON.stringify({
          headline: "x",
          summary: "y",
          whyItMatters: "z",
          keyFacts: [],
          entities: [],
          confidence: "nope",
        }),
      ),
    ).toThrow();
  });

  it("builds a compact cluster input (not one prompt blob per unrelated article dump)", async () => {
    const processed = await processArticles(
      [
        makeArticle({
          title: "OpenAI unveils multimodal artificial intelligence model",
          url: "https://www.reuters.com/openai",
          sourceName: "Reuters",
          publishedAt: "2026-09-12T10:00:00.000Z",
          snippet: "OpenAI unveiled a multimodal artificial intelligence model.",
          sourceTier: 1,
        }),
        makeArticle({
          title: "OpenAI launches multimodal artificial intelligence model",
          url: "https://www.bbc.com/openai",
          sourceName: "BBC",
          publishedAt: "2026-09-12T10:10:00.000Z",
          snippet: "OpenAI launched a multimodal artificial intelligence model.",
          sourceTier: 1,
        }),
      ],
      TOPIC,
      { now: NOW },
    );

    const cluster = processed.stories[0];
    const input = buildSummarizationInput(cluster, TOPIC, 6);
    expect(input.articles.length).toBeGreaterThanOrEqual(1);
    expect(input.articles.length).toBeLessThanOrEqual(6);
    expect(input.articles[0]).toHaveProperty("source");
    expect(input.articles[0]).toHaveProperty("title");
    expect(input.articles[0]).not.toHaveProperty("rawHtml");
  });

  it("uses a stable content hash and changes when underlying content changes", async () => {
    const processed = await processArticles(
      [
        makeArticle({
          title: "OpenAI unveils multimodal artificial intelligence model",
          url: "https://www.reuters.com/openai",
          sourceName: "Reuters",
          publishedAt: "2026-09-12T10:00:00.000Z",
          snippet: "OpenAI unveiled a multimodal artificial intelligence model.",
        }),
      ],
      TOPIC,
      { now: NOW },
    );
    const cluster = processed.stories[0];
    const hash1 = storyContentHash(cluster, TOPIC, 6);
    const hash2 = storyContentHash(cluster, TOPIC, 6);
    expect(hash1).toBe(hash2);

    const changed = {
      ...cluster,
      representativeArticle: {
        ...cluster.representativeArticle,
        description: "Updated snippet with new reported detail.",
      },
    };
    expect(storyContentHash(changed, TOPIC, 6)).not.toBe(hash1);
  });

  it("calls the LLM once per story cluster, not once per article", async () => {
    const provider = makeMockProvider();
    const processed = await processArticles(
      [
        makeArticle({
          title: "OpenAI unveils multimodal artificial intelligence model",
          url: "https://www.reuters.com/openai",
          sourceName: "Reuters",
          publishedAt: "2026-09-12T10:00:00.000Z",
          snippet: "OpenAI unveiled a multimodal artificial intelligence model.",
          sourceTier: 1,
        }),
        makeArticle({
          title: "OpenAI launches multimodal artificial intelligence model",
          url: "https://www.bbc.com/openai",
          sourceName: "BBC",
          publishedAt: "2026-09-12T10:10:00.000Z",
          snippet: "OpenAI launched a multimodal artificial intelligence model.",
          sourceTier: 1,
        }),
        makeArticle({
          title: "Chipmakers expand factories for AI accelerators",
          url: "https://www.reuters.com/chips",
          sourceName: "Reuters",
          publishedAt: "2026-09-12T08:00:00.000Z",
          snippet: "Chipmakers are expanding factories for AI accelerators.",
          sourceTier: 1,
        }),
      ],
      TOPIC,
      { now: NOW },
    );

    const articleCount = processed.stories.reduce((sum, s) => sum + s.articleCount, 0);
    expect(articleCount).toBeGreaterThan(processed.storyCount);

    const result = await summarizeStoryClusters(processed.stories, TOPIC, {
      provider,
      maxStories: 10,
    });

    expect(provider.calls.length).toBe(processed.storyCount);
    expect(provider.calls.length).toBeLessThan(articleCount);
    expect(result.llmCalls).toBe(processed.storyCount);
    expect(result.stories[0].ai.isAiGenerated).toBe(true);
    expect(result.stories[0].ai.summary.length).toBeGreaterThan(20);
  });

  it("reuses cached summaries when story content hash is unchanged", async () => {
    const provider = makeMockProvider();
    const processed = await processArticles(
      [
        makeArticle({
          title: "OpenAI unveils multimodal artificial intelligence model",
          url: "https://www.reuters.com/openai-cache",
          sourceName: "Reuters",
          publishedAt: "2026-09-12T10:00:00.000Z",
          snippet: "OpenAI unveiled a multimodal artificial intelligence model.",
        }),
      ],
      TOPIC,
      { now: NOW },
    );

    const first = await summarizeStoryClusters(processed.stories, TOPIC, { provider });
    expect(first.llmCalls).toBe(1);
    expect(first.cacheHits).toBe(0);

    const second = await summarizeStoryClusters(processed.stories, TOPIC, { provider });
    expect(second.llmCalls).toBe(0);
    expect(second.cacheHits).toBe(1);
    expect(provider.calls.length).toBe(1);
    expect(second.stories[0].ai.cached).toBe(true);
  });

  it("retries malformed AI JSON then succeeds", async () => {
    let attempt = 0;
    const provider = makeMockProvider(async () => {
      attempt += 1;
      if (attempt === 1) {
        return {
          content: "not-json",
          model: "mock-gemini",
          provider: "gemini",
        };
      }
      return {
        content: JSON.stringify({
          headline: "Recovered headline",
          summary: "Recovered factual summary after retry.",
          whyItMatters: "Readers need accurate reporting.",
          keyFacts: ["Recovered fact"],
          entities: ["OpenAI"],
          confidence: "medium",
          uncertaintyNotes: [],
          sourceDisagreements: [],
          reportedFacts: ["Source reports recovered fact"],
          inferences: [],
        }),
        model: "mock-gemini",
        provider: "gemini",
      };
    });

    const processed = await processArticles(
      [
        makeArticle({
          title: "OpenAI unveils multimodal artificial intelligence model",
          url: "https://www.reuters.com/openai-retry",
          sourceName: "Reuters",
          publishedAt: "2026-09-12T10:00:00.000Z",
          snippet: "OpenAI unveiled a multimodal artificial intelligence model.",
        }),
      ],
      TOPIC,
      { now: NOW },
    );

    const result = await summarizeStoryClusters(processed.stories, TOPIC, { provider });
    expect(attempt).toBe(2);
    expect(result.stories[0].ai.headline).toBe("Recovered headline");
    expect(result.stories[0].ai.isAiGenerated).toBe(true);
  });

  it("falls back without inventing facts when the provider fails", async () => {
    const provider = makeMockProvider(async () => {
      throw new Error("boom");
    });

    // Force single attempt by stubbing env retries via always failing complete
    // (completeWithValidation will retry; still ends in fallback)
    const processed = await processArticles(
      [
        makeArticle({
          title: "OpenAI unveils multimodal artificial intelligence model",
          url: "https://www.reuters.com/openai-fail",
          sourceName: "Reuters",
          publishedAt: "2026-09-12T10:00:00.000Z",
          snippet: "OpenAI unveiled a multimodal artificial intelligence model.",
        }),
      ],
      TOPIC,
      { now: NOW },
    );

    const result = await summarizeStoryClusters(processed.stories, TOPIC, { provider });
    expect(result.stories[0].ai.isAiGenerated).toBe(false);
    expect(result.stories[0].ai.confidence).toBe("low");
    expect(result.stories[0].ai.summary).toContain("OpenAI");
  });
});
