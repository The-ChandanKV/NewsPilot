import { describe, expect, it } from "vitest";
import { getScoringConfig } from "@/config/scoring";
import { dedupeExactUrls } from "@/lib/pipeline/dedupe";
import { normalizeArticles } from "@/lib/pipeline/normalize";
import { processArticles } from "@/lib/pipeline/process";
import {
  pickRepresentativeArticle,
  selectRepresentativeHeadline,
} from "@/lib/pipeline/rank";
import { DeterministicSimilarityProvider } from "@/lib/similarity/deterministic";
import { makeArticle } from "../helpers/articles";

const NOW = new Date("2026-09-12T12:00:00.000Z");
const TOPIC = "Artificial Intelligence";
const similarity = new DeterministicSimilarityProvider();

describe("intelligent deduplication and story clustering", () => {
  it("removes exact duplicate URLs and reports the count", async () => {
    const result = await processArticles(
      [
        makeArticle({
          title: "OpenAI launches new AI model",
          url: "https://www.reuters.com/openai",
          sourceName: "Reuters",
          publishedAt: "2026-09-12T10:00:00.000Z",
        }),
        makeArticle({
          title: "OpenAI launches new AI model",
          url: "https://reuters.com/openai?utm_source=twitter",
          sourceName: "Reuters",
          publishedAt: "2026-09-12T10:01:00.000Z",
          snippet: "Longer snippet kept.",
        }),
        makeArticle({
          title: "Unrelated markets update",
          url: "https://www.reuters.com/markets",
          sourceName: "Reuters",
          publishedAt: "2026-09-12T09:00:00.000Z",
        }),
      ],
      TOPIC,
      { now: NOW },
    );

    expect(result.dedupeStats.exactUrlDuplicatesRemoved).toBe(1);
    expect(result.dedupeStats.afterDedupe).toBe(2);
  });

  it("detects similar headlines with synonym-aware scoring", () => {
    const score = similarity.similarity(
      { title: "OpenAI launches new AI model" },
      { title: "OpenAI announces latest AI model" },
    );
    expect(score).toBeGreaterThan(0.45);
  });

  it("clusters the same event with different wording into one story", async () => {
    const result = await processArticles(
      [
        makeArticle({
          title: "OpenAI launches new AI model",
          url: "https://www.reuters.com/openai-1",
          sourceName: "Reuters",
          publishedAt: "2026-09-12T09:00:00.000Z",
          snippet: "OpenAI launched a new AI model for developers.",
          sourceTier: 1,
        }),
        makeArticle({
          title: "OpenAI announces latest AI model",
          url: "https://www.theverge.com/openai-2",
          sourceName: "The Verge",
          publishedAt: "2026-09-12T10:00:00.000Z",
          snippet: "OpenAI announced its latest AI model today.",
          sourceTier: 2,
        }),
        makeArticle({
          title: "New OpenAI model released today",
          url: "https://techcrunch.com/openai-3",
          sourceName: "TechCrunch",
          publishedAt: "2026-09-12T11:00:00.000Z",
          snippet: "A new OpenAI model was released today.",
          sourceTier: 2,
        }),
        makeArticle({
          title: "Bloomberg: OpenAI rolls out fresh AI model",
          url: "https://www.bloomberg.com/openai-4",
          sourceName: "Bloomberg",
          publishedAt: "2026-09-12T11:30:00.000Z",
          snippet: "OpenAI is rolling out a fresh AI model.",
          sourceTier: 2,
        }),
      ],
      TOPIC,
      {
        now: NOW,
        scoring: getScoringConfig({
          STORY_CLUSTER_SIMILARITY_THRESHOLD: 0.4,
        }),
      },
    );

    expect(result.storyCount).toBe(1);
    const story = result.stories[0];
    expect(story.sources).toEqual(
      expect.arrayContaining(["Reuters", "The Verge", "TechCrunch", "Bloomberg"]),
    );
    expect(story.sourceCount).toBe(4);
    expect(story.articles).toHaveLength(4);
    expect(story.headline).toBeTruthy();
    expect(story.firstPublishedAt).toBe("2026-09-12T09:00:00.000Z");
    expect(story.latestPublishedAt).toBe("2026-09-12T11:30:00.000Z");
    expect(story.similarityScore).toBeGreaterThan(0.4);
    expect(result.dedupeStats.duplicateArticlesCollapsed).toBe(3);
  });

  it("keeps unrelated stories separate", async () => {
    const result = await processArticles(
      [
        makeArticle({
          title: "OpenAI launches new AI model",
          url: "https://www.reuters.com/openai",
          sourceName: "Reuters",
          publishedAt: "2026-09-12T10:00:00.000Z",
          snippet: "OpenAI launched a new AI model.",
        }),
        makeArticle({
          title: "Federal Reserve signals possible rate cut",
          url: "https://www.reuters.com/fed",
          sourceName: "Reuters",
          publishedAt: "2026-09-12T10:05:00.000Z",
          snippet: "The Federal Reserve signaled a possible interest rate cut.",
        }),
      ],
      TOPIC,
      { now: NOW },
    );

    expect(result.storyCount).toBe(2);
    expect(result.dedupeStats.clusterCount).toBe(2);
    expect(result.dedupeStats.duplicateArticlesCollapsed).toBe(0);
  });

  it("preserves multiple credible sources inside a cluster", async () => {
    const result = await processArticles(
      [
        makeArticle({
          title: "OpenAI launches new AI model",
          url: "https://www.reuters.com/a",
          sourceName: "Reuters",
          publishedAt: "2026-09-12T10:00:00.000Z",
          snippet: "OpenAI launched a new AI model.",
          sourceTier: 1,
        }),
        makeArticle({
          title: "OpenAI announces latest AI model",
          url: "https://www.bbc.com/b",
          sourceName: "BBC",
          publishedAt: "2026-09-12T10:10:00.000Z",
          snippet: "OpenAI announced its latest AI model.",
          sourceTier: 1,
        }),
      ],
      TOPIC,
      {
        now: NOW,
        scoring: getScoringConfig({ STORY_CLUSTER_SIMILARITY_THRESHOLD: 0.4 }),
      },
    );

    expect(result.stories[0].sources).toEqual(
      expect.arrayContaining(["Reuters", "BBC"]),
    );
    expect(result.stories[0].sourceCount).toBe(2);
  });

  it("prefers a more recent article as primary when quality is comparable", () => {
    const articles = normalizeArticles([
      makeArticle({
        title: "OpenAI launches new AI model",
        url: "https://www.reuters.com/old",
        sourceName: "Reuters",
        publishedAt: "2026-09-12T08:00:00.000Z",
        sourceTier: 1,
      }),
      makeArticle({
        title: "OpenAI launches new AI model update",
        url: "https://www.reuters.com/new",
        sourceName: "Reuters",
        publishedAt: "2026-09-12T11:00:00.000Z",
        sourceTier: 1,
      }),
    ]);

    const primary = pickRepresentativeArticle(articles);
    expect(primary.url).toContain("/new");
    expect(selectRepresentativeHeadline(articles, primary)).toBeTruthy();
  });

  it("tracks old vs new versions via first/latest timestamps", async () => {
    const result = await processArticles(
      [
        makeArticle({
          title: "OpenAI launches new AI model",
          url: "https://www.reuters.com/v1",
          sourceName: "Reuters",
          publishedAt: "2026-09-11T08:00:00.000Z",
          snippet: "OpenAI launched a new AI model.",
        }),
        makeArticle({
          title: "OpenAI announces latest AI model",
          url: "https://www.bbc.com/v2",
          sourceName: "BBC",
          publishedAt: "2026-09-12T11:00:00.000Z",
          snippet: "OpenAI announced its latest AI model with more detail.",
        }),
      ],
      TOPIC,
      {
        now: NOW,
        scoring: getScoringConfig({ STORY_CLUSTER_SIMILARITY_THRESHOLD: 0.4 }),
      },
    );

    expect(result.storyCount).toBe(1);
    expect(result.stories[0].firstPublishedAt).toBe("2026-09-11T08:00:00.000Z");
    expect(result.stories[0].latestPublishedAt).toBe("2026-09-12T11:00:00.000Z");
  });

  it("reports how many duplicate articles were removed/collapsed", async () => {
    const normalized = normalizeArticles([
      makeArticle({
        title: "Same URL story",
        url: "https://www.reuters.com/same",
        sourceName: "Reuters",
        publishedAt: "2026-09-12T10:00:00.000Z",
      }),
      makeArticle({
        title: "Same URL story",
        url: "https://reuters.com/same?utm_campaign=x",
        sourceName: "Reuters",
        publishedAt: "2026-09-12T10:01:00.000Z",
      }),
    ]);
    expect(dedupeExactUrls(normalized)).toHaveLength(1);

    const result = await processArticles(
      [
        makeArticle({
          title: "OpenAI launches new AI model",
          url: "https://www.reuters.com/1",
          sourceName: "Reuters",
          publishedAt: "2026-09-12T09:00:00.000Z",
          snippet: "OpenAI launched a new AI model.",
        }),
        makeArticle({
          title: "OpenAI announces latest AI model",
          url: "https://www.theverge.com/2",
          sourceName: "The Verge",
          publishedAt: "2026-09-12T10:00:00.000Z",
          snippet: "OpenAI announced its latest AI model.",
        }),
        makeArticle({
          title: "New OpenAI model released today",
          url: "https://techcrunch.com/3",
          sourceName: "TechCrunch",
          publishedAt: "2026-09-12T11:00:00.000Z",
          snippet: "A new OpenAI model was released today.",
        }),
        makeArticle({
          title: "OpenAI launches new AI model",
          url: "https://www.reuters.com/1?utm_source=rss",
          sourceName: "Reuters",
          publishedAt: "2026-09-12T09:05:00.000Z",
          snippet: "OpenAI launched a new AI model.",
        }),
      ],
      TOPIC,
      {
        now: NOW,
        scoring: getScoringConfig({ STORY_CLUSTER_SIMILARITY_THRESHOLD: 0.4 }),
      },
    );

    expect(result.dedupeStats.exactUrlDuplicatesRemoved).toBeGreaterThanOrEqual(1);
    expect(result.dedupeStats.duplicateArticlesCollapsed).toBeGreaterThanOrEqual(1);
    expect(result.dedupeStats.clusterCount).toBe(1);
    expect(result.dedupeStats.compressionRatio).toBeLessThan(1);
  });
});
