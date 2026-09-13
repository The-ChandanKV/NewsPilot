import { beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { resetEnvForTests } from "@/config/env";
import { resetDbConnectionForTests } from "@/lib/db/client";
import { migrate } from "@/lib/db/migrate";
import {
  addUserTopic,
  listUserTopics,
  removeUserTopic,
  renameUserTopic,
  reorderUserTopics,
  setTopicFrequency,
} from "@/lib/topics/store";
import {
  dedupePersonalizedStories,
  scorePersonalizedStory,
  toPersonalizedStory,
} from "@/lib/topics/ranking";
import { buildPersonalizedFeed } from "@/lib/topics/personalized-feed";
import type { UserTopic } from "@/lib/topics/types";
import type { DailyBriefing, DailyBriefingStory } from "@/types/briefing";

function makeVerification(sourceDiversity = 0.6) {
  return {
    level: "confirmed" as const,
    label: "Multiple sources",
    detail: "2 independent sources",
    icon: "check" as const,
    sourceCount: 2,
    independentSourceCount: 2,
    sourceDiversity,
    sourceRecency: 0.8,
    sourceQualityScore: 0.9,
    multipleSourcesConfirmEvent: true,
    firstReportedBy: "Reuters",
    signals: [],
    explanation: "test",
    publishers: [],
  };
}

function makeChange() {
  return {
    status: "new" as const,
    stableId: "s1",
    firstSeenAt: "2026-09-12T12:00:00.000Z",
    lastUpdatedAt: "2026-09-12T12:00:00.000Z",
    previousState: null,
    currentState: {
      headline: "h",
      summary: "s",
      sources: ["Reuters"],
      articleUrls: ["https://www.reuters.com/a"],
      publishedAt: "2026-09-12T10:00:00.000Z",
    },
    changeSummary: "First seen",
    materialChange: true,
    matchedPreviousId: null,
  };
}

function makeStory(
  overrides: Partial<DailyBriefingStory> & Pick<DailyBriefingStory, "id" | "headline">,
): DailyBriefingStory {
  return {
    summary: "Summary about artificial intelligence.",
    whyItMatters: "Why",
    keyFacts: ["Fact"],
    entities: ["OpenAI"],
    publishedAt: "2026-09-12T10:00:00.000Z",
    primarySource: "Reuters",
    relatedSources: [],
    articleUrls: ["https://www.reuters.com/a"],
    confidence: "high",
    uncertaintyNotes: [],
    sourceDisagreements: [],
    isAiGenerated: true,
    importanceScore: 0.7,
    coveredBy: "Reuters",
    verification: makeVerification(),
    change: makeChange(),
    ...overrides,
  };
}

describe("user topics store", () => {
  beforeEach(() => {
    const dbPath = path.join(
      os.tmpdir(),
      `newspilot-topics-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
    );
    process.env.DATABASE_URL = dbPath;
    resetEnvForTests();
    resetDbConnectionForTests();
    migrate();
  });

  it("adds, renames, sets frequency, reorders, and removes topics", () => {
    const clientId = "client-1";
    const a = addUserTopic(clientId, { topic: "Artificial Intelligence" });
    const b = addUserTopic(clientId, {
      topic: "Cybersecurity",
      frequency: "weekly",
    });
    expect(listUserTopics(clientId)).toHaveLength(2);
    expect(b.frequency).toBe("weekly");

    const renamed = renameUserTopic(clientId, a.id, "AI Research");
    expect(renamed.topic).toBe("AI Research");

    const freq = setTopicFrequency(clientId, b.id, "twice_daily");
    expect(freq.frequency).toBe("twice_daily");

    const reordered = reorderUserTopics(clientId, [b.id, a.id]);
    expect(reordered.map((t) => t.topic)).toEqual([
      "Cybersecurity",
      "AI Research",
    ]);
    expect(reordered[0].sortOrder).toBe(0);

    removeUserTopic(clientId, b.id);
    expect(listUserTopics(clientId).map((t) => t.topic)).toEqual(["AI Research"]);

    fs.rmSync(process.env.DATABASE_URL!, { force: true });
  });

  it("rejects duplicate topics for the same client", () => {
    const clientId = "client-2";
    addUserTopic(clientId, { topic: "Space" });
    expect(() => addUserTopic(clientId, { topic: "space" })).toThrow(/already/i);
  });
});

describe("personalized ranking", () => {
  const topicHigh: UserTopic = {
    id: "t1",
    clientId: "c",
    topic: "Artificial Intelligence",
    normalizedTopic: "artificial-intelligence",
    sortOrder: 0,
    frequency: "daily",
    createdAt: "2026-09-12T00:00:00.000Z",
    updatedAt: "2026-09-12T00:00:00.000Z",
  };
  const topicLow: UserTopic = {
    ...topicHigh,
    id: "t2",
    topic: "Space",
    normalizedTopic: "space",
    sortOrder: 1,
    frequency: "weekly",
  };

  it("boosts higher-priority topics in personalScore", () => {
    const story = makeStory({
      id: "s1",
      headline: "Artificial intelligence model launch",
      importanceScore: 0.6,
    });
    const high = scorePersonalizedStory({
      story,
      topic: topicHigh,
      topicCount: 2,
      now: new Date("2026-09-12T12:00:00.000Z"),
    });
    const low = scorePersonalizedStory({
      story: { ...story, headline: "Space telescope update" },
      topic: topicLow,
      topicCount: 2,
      now: new Date("2026-09-12T12:00:00.000Z"),
    });
    expect(high).toBeGreaterThan(low);
  });

  it("dedupes overlapping stories across topics", () => {
    const shared = makeStory({
      id: "shared",
      headline: "Shared event",
      articleUrls: ["https://www.reuters.com/shared", "https://www.bbc.com/shared"],
      importanceScore: 0.5,
    });
    const a = toPersonalizedStory(shared, topicHigh, 2);
    const b = toPersonalizedStory(
      {
        ...shared,
        id: "shared-2",
        importanceScore: 0.9,
      },
      topicLow,
      2,
    );
    const deduped = dedupePersonalizedStories([a, b]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].alsoInTopics.length).toBeGreaterThan(0);
  });
});

describe("personalized feed builder", () => {
  beforeEach(() => {
    const dbPath = path.join(
      os.tmpdir(),
      `newspilot-feed-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
    );
    process.env.DATABASE_URL = dbPath;
    resetEnvForTests();
    resetDbConnectionForTests();
    migrate();
  });

  it("merges topic briefings without an extra AI summarization pass", async () => {
    const clientId = "feed-client";
    addUserTopic(clientId, { topic: "Artificial Intelligence" });
    addUserTopic(clientId, { topic: "Cybersecurity" });

    let briefingCalls = 0;
    const feed = await buildPersonalizedFeed(clientId, {
      now: new Date("2026-09-12T12:00:00.000Z"),
      buildBriefing: async (topic) => {
        briefingCalls += 1;
        const story = makeStory({
          id: `${topic}-1`,
          headline: `${topic} headline`,
          articleUrls: [`https://www.reuters.com/${encodeURIComponent(topic)}`],
          summary: `News about ${topic}`,
        });
        const briefing: DailyBriefing = {
          topic,
          generatedAt: "2026-09-12T12:00:00.000Z",
          timeRange: {
            from: "2026-09-10T12:00:00.000Z",
            to: "2026-09-12T12:00:00.000Z",
            hours: 48,
          },
          totalStories: 1,
          cached: true,
          llmCalls: 0,
          summaryCacheHits: 1,
          providerUsed: "gemini",
          warnings: [],
          whatsNew: {
            comparedToGeneratedAt: null,
            label: "What's new",
            newCount: 1,
            updatedCount: 0,
            ongoingCount: 0,
            highlights: [],
          },
          stories: [story],
        };
        return briefing;
      },
    });

    expect(briefingCalls).toBe(2);
    expect(feed.stories.length).toBe(2);
    expect(feed.llmCalls).toBe(0);
    expect(feed.summaryCacheHits).toBe(2);
    expect(feed.stories[0].matchedTopic).toBeTruthy();

    fs.rmSync(process.env.DATABASE_URL!, { force: true });
  });
});
