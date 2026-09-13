import { beforeEach, describe, expect, it, vi } from "vitest";
import os from "os";
import path from "path";
import { resetEnvForTests } from "@/config/env";
import { resetDbConnectionForTests } from "@/lib/db/client";
import { migrate } from "@/lib/db/migrate";
import { saveStoredDailyBriefing } from "@/lib/jobs/daily-briefing-store";
import { answerResearchQuestion } from "@/lib/research/answer";
import { buildResearchContext } from "@/lib/research/context";
import { retrieveRelevantStories } from "@/lib/research/retrieve";
import type { LlmProvider } from "@/lib/providers/llm/types";
import type { StoredDailyBriefing } from "@/lib/jobs/types";

function makeStored(topic: string, date: string): Omit<StoredDailyBriefing, "id"> {
  return {
    topic,
    date,
    generatedAt: `${date}T06:00:00.000Z`,
    stories: [
      {
        id: "openai-story",
        headline: "OpenAI launches new model for enterprise",
        summary:
          "OpenAI announced a new enterprise model with stronger safety controls.",
        whyItMatters:
          "Enterprises may shift AI budgets toward OpenAI's new tier.",
        keyFacts: ["Announced today", "Enterprise focus"],
        entities: ["OpenAI", "Microsoft"],
        publishedAt: `${date}T05:00:00.000Z`,
        primarySource: "Reuters",
        relatedSources: [
          {
            name: "The Verge",
            title: "OpenAI enterprise model",
            url: "https://www.theverge.com/openai-enterprise",
          },
        ],
        articleUrls: [
          "https://www.reuters.com/openai-enterprise",
          "https://www.theverge.com/openai-enterprise",
        ],
        confidence: "high",
        uncertaintyNotes: [],
        sourceDisagreements: [
          {
            issue: "Pricing details",
            positions: [
              { source: "Reuters", claim: "Pricing not disclosed" },
              { source: "The Verge", claim: "Starting later this year" },
            ],
          },
        ],
        isAiGenerated: true,
        importanceScore: 0.9,
        coveredBy: "Reuters · The Verge",
        verification: {
          level: "confirmed",
          label: "Corroborated",
          detail: "Multiple sources",
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
          status: "updated",
          stableId: "stable-openai",
          firstSeenAt: `${date}T01:00:00.000Z`,
          lastUpdatedAt: `${date}T06:00:00.000Z`,
          previousState: null,
          currentState: {
            headline: "OpenAI launches new model for enterprise",
            summary: "OpenAI announced a new enterprise model.",
            sources: ["Reuters", "The Verge"],
            articleUrls: ["https://www.reuters.com/openai-enterprise"],
            publishedAt: `${date}T05:00:00.000Z`,
            contentHash: "hash",
          },
          changeSummary: "Added enterprise positioning since yesterday",
          materialChange: true,
          matchedPreviousId: "prev",
        },
      },
    ],
    changes: {
      comparedToGeneratedAt: `${date}T01:00:00.000Z`,
      label: "What's changed",
      newCount: 0,
      updatedCount: 1,
      ongoingCount: 0,
      highlights: [
        {
          status: "updated",
          headline: "OpenAI launches new model for enterprise",
          changeSummary: "Added enterprise positioning since yesterday",
        },
      ],
    },
    generationStats: {
      articlesRetrieved: 4,
      duplicateArticlesRemoved: 1,
      storyClustersCreated: 1,
      aiCalls: 1,
      cachedSummaries: 0,
      generationDurationMs: 10,
    },
    warnings: [],
    topDevelopments: ["OpenAI launches new model for enterprise"],
    whyItMatters: ["Enterprises may shift AI budgets toward OpenAI's new tier."],
  };
}

function mockProvider(content: string): LlmProvider {
  return {
    name: "gemini",
    isConfigured: () => true,
    complete: vi.fn(async () => ({
      content,
      model: "test-model",
      provider: "gemini" as const,
    })),
  };
}

describe("research RAG", () => {
  beforeEach(() => {
    const dbPath = path.join(
      os.tmpdir(),
      `newspilot-research-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
    );
    process.env.DATABASE_URL = dbPath;
    process.env.RESEARCH_MAX_CONTEXT_STORIES = "5";
    process.env.RESEARCH_MIN_RELEVANCE = "0.1";
    process.env.RESEARCH_BRIEFING_SCAN_LIMIT = "20";
    resetEnvForTests();
    resetDbConnectionForTests();
    migrate();
  });

  it("retrieves only relevant OpenAI stories from stored briefings", () => {
    saveStoredDailyBriefing(makeStored("Artificial Intelligence", "2026-09-13"));
    saveStoredDailyBriefing({
      topic: "Space",
      date: "2026-09-13",
      generatedAt: "2026-09-13T06:00:00.000Z",
      stories: [
        {
          ...makeStored("Space", "2026-09-13").stories[0],
          id: "rocket",
          headline: "Rocket launch delayed",
          summary: "Weather scrubbed the launch window.",
          whyItMatters: "Schedule slip for orbital missions.",
          keyFacts: ["Launch window closed"],
          entities: ["NASA"],
          primarySource: "Reuters",
          relatedSources: [],
          articleUrls: ["https://www.reuters.com/rocket"],
          coveredBy: "Reuters",
          change: {
            ...makeStored("Space", "2026-09-13").stories[0].change,
            changeSummary: "Delay announced",
            currentState: {
              headline: "Rocket launch delayed",
              summary: "Weather scrubbed the launch window.",
              sources: ["Reuters"],
              articleUrls: ["https://www.reuters.com/rocket"],
              publishedAt: "2026-09-13T05:00:00.000Z",
              contentHash: "rocket-hash",
            },
          },
        },
      ],
      changes: {
        comparedToGeneratedAt: null,
        label: "What's new",
        newCount: 1,
        updatedCount: 0,
        ongoingCount: 0,
        highlights: [],
      },
      generationStats: {
        articlesRetrieved: 1,
        duplicateArticlesRemoved: 0,
        storyClustersCreated: 1,
        aiCalls: 0,
        cachedSummaries: 0,
        generationDurationMs: 1,
      },
      warnings: [],
      topDevelopments: ["Rocket launch delayed"],
      whyItMatters: ["Schedule slip for orbital missions."],
    });

    const { stories, scannedBriefings } = retrieveRelevantStories({
      question: "What happened with OpenAI today?",
    });

    expect(scannedBriefings).toBe(2);
    expect(stories.length).toBeGreaterThan(0);
    expect(stories[0].headline).toMatch(/OpenAI/i);
    expect(stories.every((s) => /openai/i.test(s.headline + s.summary))).toBe(
      true,
    );
    expect(stories.length).toBeLessThanOrEqual(5);
  });

  it("answers with citations and refuses when nothing matches", async () => {
    saveStoredDailyBriefing(makeStored("Artificial Intelligence", "2026-09-13"));

    const provider = mockProvider(
      "OpenAI announced an enterprise model [S1].\n\nSources:\n[S1] OpenAI launches new model for enterprise — https://www.reuters.com/openai-enterprise",
    );

    const answered = await answerResearchQuestion(
      { question: "What happened with OpenAI today?" },
      { provider },
    );
    expect(answered.insufficient).toBe(false);
    expect(answered.citations.length).toBeGreaterThan(0);
    expect(answered.citations[0].url).toContain("http");
    expect(provider.complete).toHaveBeenCalledOnce();
    const call = vi.mocked(provider.complete).mock.calls[0][0];
    expect(call.messages[0].content).toContain("ONLY using the RETRIEVED");
    expect(call.messages[1].content).not.toContain("Rocket launch delayed");

    const empty = await answerResearchQuestion(
      { question: "What happened with the cricket world cup final?" },
      { provider: mockProvider("should not run") },
    );
    expect(empty.insufficient).toBe(true);
    expect(empty.citations).toHaveLength(0);
  });

  it("builds compact context with source comparison fields", () => {
    const stored = saveStoredDailyBriefing(
      makeStored("Artificial Intelligence", "2026-09-13"),
    );
    const { stories } = retrieveRelevantStories({
      question: "Compare how different sources reported OpenAI",
    });
    const context = buildResearchContext(stories);
    expect(context).toContain("<<<UNTRUSTED_RETRIEVED_NEWS_START>>>");
    expect(context).toContain("[S1]");
    expect(context).toContain("sourceDisagreements");
    expect(context).toContain(stored.stories[0].headline);
    expect(context).toContain("The Verge");
  });
});
