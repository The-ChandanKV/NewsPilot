import { describe, expect, it } from "vitest";
import { renderDailyBriefingEmail } from "@/lib/notifications/render-email";
import type { StoredDailyBriefing } from "@/lib/jobs/types";

const briefing: StoredDailyBriefing = {
  id: "brief-1",
  topic: "Space",
  date: "2026-09-13",
  generatedAt: "2026-09-13T06:00:00.000Z",
  stories: [
    {
      id: "s1",
      headline: "Rocket launch succeeds",
      summary: "A reusable booster returned safely.",
      whyItMatters: "Lowers launch costs for commercial missions.",
      keyFacts: [],
      entities: [],
      publishedAt: "2026-09-13T05:00:00.000Z",
      primarySource: "Reuters",
      relatedSources: [],
      articleUrls: ["https://www.reuters.com/space-launch"],
      confidence: "high",
      uncertaintyNotes: [],
      sourceDisagreements: [],
      isAiGenerated: true,
      importanceScore: 0.9,
      coveredBy: "Reuters",
      verification: {
        level: "limited",
        label: "Limited reporting",
        detail: "Only one source",
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
      change: {
        status: "new",
        stableId: "stable-1",
        firstSeenAt: "2026-09-13T06:00:00.000Z",
        lastUpdatedAt: "2026-09-13T06:00:00.000Z",
        previousState: null,
        currentState: {
          headline: "Rocket launch succeeds",
          summary: "A reusable booster returned safely.",
          sources: ["Reuters"],
          articleUrls: ["https://www.reuters.com/space-launch"],
          publishedAt: "2026-09-13T05:00:00.000Z",
          contentHash: "hash",
        },
        changeSummary: "First seen",
        materialChange: true,
        matchedPreviousId: null,
      },
    },
  ],
  changes: {
    comparedToGeneratedAt: null,
    label: "What's new",
    newCount: 1,
    updatedCount: 0,
    ongoingCount: 0,
    highlights: [
      {
        status: "new",
        headline: "Rocket launch succeeds",
        changeSummary: "First seen",
      },
    ],
  },
  generationStats: {
    articlesRetrieved: 10,
    duplicateArticlesRemoved: 2,
    storyClustersCreated: 3,
    aiCalls: 1,
    cachedSummaries: 0,
    generationDurationMs: 100,
  },
  warnings: [],
  topDevelopments: ["Rocket launch succeeds"],
  whyItMatters: ["Lowers launch costs for commercial missions."],
};

describe("renderDailyBriefingEmail", () => {
  it("renders topic, date, stories, why it matters, sources, and changes", () => {
    const rendered = renderDailyBriefingEmail(briefing, {
      unsubscribeUrl: "http://localhost:3000/api/email/unsubscribe?token=abc",
    });

    expect(rendered.subject).toContain("Space");
    expect(rendered.subject).toContain("September");
    expect(rendered.text).toContain("Rocket launch succeeds");
    expect(rendered.text).toContain("A reusable booster returned safely.");
    expect(rendered.text).toContain("Why it matters");
    expect(rendered.text).toContain("https://www.reuters.com/space-launch");
    expect(rendered.text).toContain("NEW: Rocket launch succeeds");
    expect(rendered.text).toContain("Unsubscribe:");
    expect(rendered.html).toContain("What's changed");
    expect(rendered.html).toContain("href=\"http://localhost:3000/api/email/unsubscribe?token=abc\"");
  });
});
