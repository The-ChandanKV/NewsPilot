import { describe, expect, it } from "vitest";
import {
  assessClusterChange,
  buildDeterministicChangeSummary,
  buildWhatsNewSummary,
  detectMaterialChange,
  matchPriorStory,
  type PriorStorySnapshot,
  urlOverlapScore,
} from "@/lib/pipeline/change-detection";
import { processArticles } from "@/lib/pipeline/process";
import { makeArticle } from "../helpers/articles";
import type { DailyBriefingStory } from "@/types/briefing";

const NOW = "2026-09-13T12:00:00.000Z";
const YESTERDAY = "2026-09-12T12:00:00.000Z";

function prior(overrides: Partial<PriorStorySnapshot> = {}): PriorStorySnapshot {
  return {
    stableId: "stable-openai",
    clusterId: "cluster-1",
    firstSeenAt: YESTERDAY,
    lastUpdatedAt: YESTERDAY,
    contentHash: "abc123",
    headline: "OpenAI announced model X",
    summary: "OpenAI announced model X.",
    whyItMatters: "Model releases matter for competition.",
    keyFacts: ["OpenAI announced model X"],
    entities: ["OpenAI"],
    confidence: "high",
    uncertaintyNotes: [],
    sourceDisagreements: [],
    isAiGenerated: true,
    sources: ["Reuters"],
    articleUrls: ["https://www.reuters.com/openai-x"],
    publishedAt: "2026-09-12T10:00:00.000Z",
    primarySource: "Reuters",
    provider: "gemini",
    ...overrides,
  };
}

describe("change detection", () => {
  it("scores URL overlap for the same event across briefings", () => {
    expect(
      urlOverlapScore(
        ["https://www.reuters.com/openai-x", "https://www.bbc.com/openai-x"],
        ["https://www.reuters.com/openai-x"],
      ),
    ).toBeGreaterThan(0.25);
  });

  it("marks unmatched stories as NEW", async () => {
    const processed = await processArticles(
      [
        makeArticle({
          title: "Brand new chipmaker expands AI fabs",
          url: "https://www.reuters.com/chips-new",
          sourceName: "Reuters",
          publishedAt: "2026-09-13T09:00:00.000Z",
          snippet: "A chipmaker expanded AI fabs.",
        }),
      ],
      "AI",
      { now: new Date(NOW) },
    );

    const change = assessClusterChange({
      cluster: processed.stories[0],
      contentHash: "hash-new",
      prior: null,
      nowIso: NOW,
    });

    expect(change.status).toBe("new");
    expect(change.previousState).toBeNull();
    expect(change.firstSeenAt).toBe(NOW);
    expect(change.changeSummary).toMatch(/first seen/i);
  });

  it("marks unchanged matched stories as ONGOING and reuses timestamps", async () => {
    const processed = await processArticles(
      [
        makeArticle({
          title: "OpenAI announced model X",
          url: "https://www.reuters.com/openai-x",
          sourceName: "Reuters",
          publishedAt: "2026-09-12T10:00:00.000Z",
          snippet: "OpenAI announced model X.",
        }),
      ],
      "AI",
      { now: new Date(NOW) },
    );

    const previous = prior({
      contentHash: "same-hash",
      articleUrls: ["https://www.reuters.com/openai-x"],
      sources: ["Reuters"],
      headline: processed.stories[0].headline,
    });

    const change = assessClusterChange({
      cluster: processed.stories[0],
      contentHash: "same-hash",
      prior: previous,
      nowIso: NOW,
    });

    expect(change.status).toBe("ongoing");
    expect(change.materialChange).toBe(false);
    expect(change.changeSummary).toBeNull();
    expect(change.firstSeenAt).toBe(YESTERDAY);
    expect(change.lastUpdatedAt).toBe(YESTERDAY);
    expect(change.stableId).toBe("stable-openai");
  });

  it("marks coverage and headline shifts as UPDATED", () => {
    const flags = detectMaterialChange(
      {
        headline: "OpenAI released model X to developers",
        sources: ["Reuters", "TechCrunch"],
        articleUrls: [
          "https://www.reuters.com/openai-x",
          "https://techcrunch.com/openai-x-dev",
        ],
        publishedAt: "2026-09-13T09:00:00.000Z",
        contentHash: "new-hash",
      },
      prior(),
    );

    expect(flags.materialChange).toBe(true);
    expect(flags.headlineChanged).toBe(true);
    expect(flags.sourcesAdded).toContain("TechCrunch");
    expect(flags.urlsAdded.length).toBe(1);

    const summary = buildDeterministicChangeSummary(
      flags,
      "OpenAI released model X to developers",
      "OpenAI announced model X",
    );
    expect(summary).toMatch(/Headline evolved/i);
    expect(summary).toMatch(/TechCrunch/);
  });

  it("matches prior stories by overlapping article URLs", () => {
    const matched = matchPriorStory(
      ["https://www.reuters.com/openai-x", "https://techcrunch.com/openai-x-dev"],
      [prior(), prior({ stableId: "other", articleUrls: ["https://example.com/z"] })],
      new Set(),
    );
    expect(matched?.stableId).toBe("stable-openai");
  });

  it("builds a What's new since yesterday label across ~24h", () => {
    const story = {
      headline: "OpenAI released model X to developers",
      change: {
        status: "updated" as const,
        changeSummary: "Headline evolved",
      },
    };

    const whatsNew = buildWhatsNewSummary({
      stories: [story as DailyBriefingStory],
      comparedToGeneratedAt: YESTERDAY,
      now: new Date(NOW),
    });

    expect(whatsNew.label).toBe("What's new since yesterday");
    expect(whatsNew.updatedCount).toBe(1);
    expect(whatsNew.highlights).toHaveLength(1);
  });
});
