import { describe, expect, it } from "vitest";
import { getScoringConfig } from "@/config/scoring";
import { areNearDuplicateHeadlines, dedupeExactUrls } from "@/lib/pipeline/dedupe";
import { normalizeArticles } from "@/lib/pipeline/normalize";
import { processArticles } from "@/lib/pipeline/process";
import { calculateFreshness } from "@/lib/pipeline/score";
import { headlineSimilarity } from "@/lib/utils/similarity";
import { makeArticle } from "../helpers/articles";

const NOW = new Date("2026-09-12T12:00:00.000Z");
const TOPIC = "Artificial Intelligence";

describe("news processing pipeline", () => {
  it("removes exact URL duplicates (including tracking-param variants)", () => {
    const articles = normalizeArticles([
      makeArticle({
        title: "OpenAI launches new model",
        url: "https://www.reuters.com/technology/openai-model",
        sourceName: "Reuters",
        publishedAt: "2026-09-12T10:00:00.000Z",
        snippet: "OpenAI launched a new artificial intelligence model.",
      }),
      makeArticle({
        title: "OpenAI launches new model",
        url: "https://reuters.com/technology/openai-model?utm_source=news&utm_medium=rss",
        sourceName: "Reuters",
        publishedAt: "2026-09-12T10:05:00.000Z",
        snippet: "OpenAI launched a new artificial intelligence model with more detail.",
      }),
    ]);

    const deduped = dedupeExactUrls(articles);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].snippet).toContain("more detail");
  });

  it("detects similar headlines as near-duplicates", () => {
    const a = "OpenAI unveils new multimodal artificial intelligence model";
    const b = "OpenAI unveils multimodal artificial intelligence model today";
    expect(headlineSimilarity(a, b)).toBeGreaterThan(0.5);
    expect(areNearDuplicateHeadlines(a, b, 0.5)).toBe(true);
  });

  it("keeps unrelated articles as separate stories", async () => {
    const result = await processArticles(
      [
        makeArticle({
          title: "OpenAI unveils new artificial intelligence model for enterprise",
          url: "https://www.reuters.com/ai/openai-model",
          sourceName: "Reuters",
          publishedAt: "2026-09-12T10:00:00.000Z",
          snippet: "OpenAI released a new artificial intelligence system.",
        }),
        makeArticle({
          title: "Local football club wins charity match in overtime",
          url: "https://example.com/sports/charity-match",
          sourceName: "Local Paper",
          publishedAt: "2026-09-12T09:00:00.000Z",
          snippet: "The underdogs staged a dramatic comeback.",
        }),
      ],
      TOPIC,
      { now: NOW },
    );

    expect(result.storyCount).toBe(2);
    const headlines = result.stories.map((story) => story.headline);
    expect(headlines.some((h) => /OpenAI/i.test(h))).toBe(true);
    expect(headlines.some((h) => /football/i.test(h))).toBe(true);
  });

  it("groups the same event from different sources into one story", async () => {
    const result = await processArticles(
      [
        makeArticle({
          title: "OpenAI unveils new multimodal artificial intelligence model",
          url: "https://www.reuters.com/technology/openai-model",
          sourceName: "Reuters",
          publishedAt: "2026-09-12T10:00:00.000Z",
          snippet: "OpenAI unveiled a multimodal artificial intelligence model for enterprises.",
          sourceTier: 1,
        }),
        makeArticle({
          title: "OpenAI launches multimodal artificial intelligence model",
          url: "https://www.bbc.com/news/openai-model",
          sourceName: "BBC",
          publishedAt: "2026-09-12T10:15:00.000Z",
          snippet: "The artificial intelligence company OpenAI launched a multimodal model.",
          sourceTier: 1,
        }),
        makeArticle({
          title: "OpenAI releases multimodal AI model for business users",
          url: "https://www.bloomberg.com/news/openai-model",
          sourceName: "Bloomberg",
          publishedAt: "2026-09-12T10:30:00.000Z",
          snippet: "Bloomberg reports OpenAI released a multimodal artificial intelligence model.",
          sourceTier: 2,
        }),
        makeArticle({
          title: "Chipmakers expand factories to meet AI chip demand",
          url: "https://www.reuters.com/technology/chipmakers",
          sourceName: "Reuters",
          publishedAt: "2026-09-12T08:00:00.000Z",
          snippet: "Semiconductor firms are expanding capacity for AI accelerators.",
          sourceTier: 1,
        }),
      ],
      TOPIC,
      {
        now: NOW,
        scoring: getScoringConfig({
          STORY_CLUSTER_SIMILARITY_THRESHOLD: 0.35,
        }),
      },
    );

    const openaiStory = result.stories.find((story) => /openai/i.test(story.headline));
    expect(openaiStory).toBeDefined();
    expect(openaiStory!.articleCount).toBeGreaterThanOrEqual(3);
    expect(openaiStory!.sourceCount).toBeGreaterThanOrEqual(3);
    expect(openaiStory!.sources).toEqual(
      expect.arrayContaining(["Reuters", "BBC", "Bloomberg"]),
    );
    expect(openaiStory!.articles.length).toBe(openaiStory!.articleCount);
    expect(openaiStory!.relatedArticles.length).toBe(openaiStory!.articleCount - 1);
  });

  it("ranks newer articles higher on freshness than older ones", () => {
    const scoring = getScoringConfig();
    const fresh = normalizeArticles([
      makeArticle({
        title: "Fresh AI breakthrough announced",
        url: "https://www.reuters.com/ai/fresh",
        sourceName: "Reuters",
        publishedAt: "2026-09-12T11:00:00.000Z",
      }),
    ]);
    const old = normalizeArticles([
      makeArticle({
        title: "Old AI breakthrough announced",
        url: "https://www.reuters.com/ai/old",
        sourceName: "Reuters",
        publishedAt: "2026-09-10T11:00:00.000Z",
      }),
    ]);

    const freshScore = calculateFreshness(fresh, NOW, scoring);
    const oldScore = calculateFreshness(old, NOW, scoring);
    expect(freshScore).toBeGreaterThan(oldScore);
  });

  it("boosts importance when multiple sources report the same event", async () => {
    const single = await processArticles(
      [
        makeArticle({
          title: "OpenAI unveils multimodal artificial intelligence model",
          url: "https://example-blog.com/openai",
          sourceName: "Example Blog",
          publishedAt: "2026-09-12T10:00:00.000Z",
          snippet: "OpenAI unveiled a multimodal artificial intelligence model.",
          sourceTier: 3,
        }),
      ],
      TOPIC,
      { now: NOW },
    );

    const multi = await processArticles(
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
          title: "OpenAI releases multimodal artificial intelligence model",
          url: "https://apnews.com/openai",
          sourceName: "AP News",
          publishedAt: "2026-09-12T10:20:00.000Z",
          snippet: "OpenAI released a multimodal artificial intelligence model.",
          sourceTier: 1,
        }),
      ],
      TOPIC,
      {
        now: NOW,
        scoring: getScoringConfig({
          STORY_CLUSTER_SIMILARITY_THRESHOLD: 0.35,
        }),
      },
    );

    expect(multi.stories[0].sourceCount).toBeGreaterThan(single.stories[0].sourceCount);
    expect(multi.stories[0].scores.sourceDiversity).toBeGreaterThan(
      single.stories[0].scores.sourceDiversity,
    );
    expect(multi.stories[0].scores.rank).toBeGreaterThan(single.stories[0].scores.rank);
  });

  it("collapses same-source near-duplicate headlines without dropping other outlets", async () => {
    const result = await processArticles(
      [
        makeArticle({
          title: "OpenAI unveils multimodal artificial intelligence model",
          url: "https://www.reuters.com/openai-a",
          sourceName: "Reuters",
          publishedAt: "2026-09-12T10:00:00.000Z",
          snippet: "OpenAI unveiled a multimodal artificial intelligence model.",
        }),
        makeArticle({
          title: "OpenAI unveils multimodal artificial intelligence model today",
          url: "https://www.reuters.com/openai-b",
          sourceName: "Reuters",
          publishedAt: "2026-09-12T10:05:00.000Z",
          snippet: "OpenAI unveiled a multimodal artificial intelligence model today.",
        }),
        makeArticle({
          title: "OpenAI launches multimodal artificial intelligence model",
          url: "https://www.bbc.com/openai",
          sourceName: "BBC",
          publishedAt: "2026-09-12T10:10:00.000Z",
          snippet: "OpenAI launched a multimodal artificial intelligence model.",
        }),
      ],
      TOPIC,
      {
        now: NOW,
        scoring: getScoringConfig({
          HEADLINE_NEAR_DUPLICATE_THRESHOLD: 0.7,
          STORY_CLUSTER_SIMILARITY_THRESHOLD: 0.35,
        }),
      },
    );

    expect(result.storyCount).toBe(1);
    expect(result.stories[0].sources).toEqual(expect.arrayContaining(["Reuters", "BBC"]));
    expect(result.stories[0].sourceCount).toBe(2);
  });
});
