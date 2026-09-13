import { describe, expect, it, vi } from "vitest";
import {
  buildDeterministicComparison,
  canCompareCoverage,
  collectSourceArticles,
  scrubPoliticalLabels,
} from "@/lib/coverage/build";
import { compareStoryCoverage } from "@/lib/coverage/compare";
import type { LlmProvider } from "@/lib/providers/llm/types";
import type { DailyBriefingStory } from "@/types/briefing";

function makeStory(overrides?: Partial<DailyBriefingStory>): DailyBriefingStory {
  return {
    id: "story-1",
    headline: "OpenAI launches enterprise model",
    summary:
      "OpenAI announced an enterprise model. Reuters and The Verge both covered the launch.",
    whyItMatters: "Enterprise AI buyers may reassess vendors.",
    keyFacts: ["Launch announced", "Enterprise focus"],
    entities: ["OpenAI"],
    publishedAt: "2026-09-13T05:00:00.000Z",
    primarySource: "Reuters",
    relatedSources: [
      {
        name: "The Verge",
        title: "OpenAI’s enterprise push",
        url: "https://www.theverge.com/openai-enterprise",
      },
    ],
    articleUrls: [
      "https://www.reuters.com/openai-enterprise",
      "https://www.theverge.com/openai-enterprise",
    ],
    confidence: "high",
    uncertaintyNotes: ["Pricing not fully disclosed"],
    sourceDisagreements: [
      {
        issue: "Pricing timeline",
        positions: [
          { source: "Reuters", claim: "Pricing not disclosed" },
          { source: "The Verge", claim: "Expected later this year" },
        ],
      },
    ],
    isAiGenerated: true,
    importanceScore: 0.9,
    coveredBy: "Reuters · The Verge",
    verification: {
      level: "confirmed",
      label: "Multiple sources",
      detail: "2 independent sources",
      icon: "check",
      sourceCount: 2,
      independentSourceCount: 2,
      sourceDiversity: 0.8,
      sourceRecency: 0.9,
      sourceQualityScore: 1,
      multipleSourcesConfirmEvent: true,
      firstReportedBy: "Reuters",
      signals: [],
      explanation: "test",
      publishers: [],
    },
    change: {
      status: "new",
      stableId: "stable",
      firstSeenAt: "2026-09-13T05:00:00.000Z",
      lastUpdatedAt: "2026-09-13T05:00:00.000Z",
      previousState: null,
      currentState: {
        headline: "OpenAI launches enterprise model",
        summary: "OpenAI announced an enterprise model.",
        sources: ["Reuters", "The Verge"],
        articleUrls: ["https://www.reuters.com/openai-enterprise"],
        publishedAt: "2026-09-13T05:00:00.000Z",
        contentHash: "h",
      },
      changeSummary: "First seen",
      materialChange: true,
      matchedPreviousId: null,
    },
    ...overrides,
  };
}

describe("source perspective comparison", () => {
  it("requires multiple source articles", () => {
    const multi = makeStory();
    expect(canCompareCoverage(multi)).toBe(true);
    expect(collectSourceArticles(multi)).toHaveLength(2);

    const single = makeStory({
      relatedSources: [],
      articleUrls: ["https://www.reuters.com/openai-enterprise"],
      coveredBy: "Reuters",
    });
    expect(canCompareCoverage(single)).toBe(false);
  });

  it("scrubs unattributed political labels", () => {
    expect(scrubPoliticalLabels("This is left-wing framing.")).toBe("");
    expect(
      scrubPoliticalLabels('Reuters said the bill is "left-leaning" in quotes.'),
    ).toContain("Reuters said");
  });

  it("builds deterministic comparison with attribution and conflicts", () => {
    const story = makeStory();
    const sources = collectSourceArticles(story);
    const comparison = buildDeterministicComparison(story, sources);
    expect(comparison.commonlyReported[0]?.sources).toContain("Reuters");
    expect(comparison.sourceReports.map((r) => r.source)).toEqual(
      expect.arrayContaining(["Reuters", "The Verge"]),
    );
    expect(comparison.conflictingClaims[0]?.issue).toContain("Pricing");
    expect(comparison.unresolved.length).toBeGreaterThan(0);
  });

  it("uses AI JSON when available and falls back when invalid", async () => {
    const story = makeStory();
    const provider: LlmProvider = {
      name: "gemini",
      isConfigured: () => true,
      complete: vi.fn(async () => ({
        content: JSON.stringify({
          commonlyReported: [
            {
              claim: "OpenAI announced an enterprise model",
              sources: ["Reuters", "The Verge"],
              articleUrls: [
                "https://www.reuters.com/openai-enterprise",
                "https://www.theverge.com/openai-enterprise",
              ],
            },
          ],
          majorityFacts: [],
          sourceReports: [
            {
              source: "Reuters",
              url: "https://www.reuters.com/openai-enterprise",
              title: "OpenAI launches enterprise model",
              details: ["Pricing not disclosed"],
            },
            {
              source: "The Verge",
              url: "https://www.theverge.com/openai-enterprise",
              title: "OpenAI’s enterprise push",
              details: ["Expected later this year"],
            },
          ],
          framingDifferences: [
            {
              description: "Reuters stresses disclosure gaps; The Verge stresses timeline.",
              sources: ["Reuters", "The Verge"],
            },
          ],
          conflictingClaims: [
            {
              issue: "Pricing timeline",
              positions: [
                {
                  source: "Reuters",
                  claim: "Pricing not disclosed",
                  url: "https://www.reuters.com/openai-enterprise",
                },
                {
                  source: "The Verge",
                  claim: "Expected later this year",
                  url: "https://www.theverge.com/openai-enterprise",
                },
              ],
            },
          ],
          missingInformation: ["Exact list pricing"],
          unresolved: ["When pricing will be published"],
        }),
        model: "test",
        provider: "gemini",
      })),
    };

    const result = await compareStoryCoverage({ story }, { provider });
    expect(result.insufficient).toBe(false);
    expect(result.deterministicFallback).toBe(false);
    expect(result.comparison?.commonlyReported[0]?.claim).toMatch(/OpenAI/);
    expect(result.comparison?.sourceReports).toHaveLength(2);
    expect(JSON.stringify(result.comparison)).not.toMatch(/\bleft\b|\bright\b|biased/i);

    const badProvider: LlmProvider = {
      name: "gemini",
      isConfigured: () => true,
      complete: vi.fn(async () => ({
        content: "not-json",
        model: "test",
        provider: "gemini",
      })),
    };
    const fallback = await compareStoryCoverage({ story }, { provider: badProvider });
    expect(fallback.deterministicFallback).toBe(true);
    expect(fallback.comparison?.conflictingClaims.length).toBeGreaterThan(0);
  });

  it("returns insufficient for single-source stories without calling AI", async () => {
    const provider: LlmProvider = {
      name: "gemini",
      isConfigured: () => true,
      complete: vi.fn(),
    };
    const result = await compareStoryCoverage(
      {
        story: makeStory({
          relatedSources: [],
          articleUrls: ["https://www.reuters.com/only"],
        }),
      },
      { provider },
    );
    expect(result.insufficient).toBe(true);
    expect(provider.complete).not.toHaveBeenCalled();
  });
});
