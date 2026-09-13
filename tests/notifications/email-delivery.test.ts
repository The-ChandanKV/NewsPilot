import { beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { resetEnvForTests } from "@/config/env";
import { resetDbConnectionForTests } from "@/lib/db/client";
import { migrate } from "@/lib/db/migrate";
import { saveStoredDailyBriefing } from "@/lib/jobs/daily-briefing-store";
import { runEmailDeliveryJob } from "@/lib/notifications/delivery";
import { LogEmailProvider } from "@/lib/notifications/providers/log-email";
import {
  getDeliveryForSubscriptionBriefing,
  listEmailDeliveries,
  upsertEmailSubscription,
  unsubscribeByToken,
} from "@/lib/notifications/subscription-store";
import type { NotificationMessage, NotificationProvider } from "@/lib/notifications/types";
import type { StoredDailyBriefing } from "@/lib/jobs/types";

function makeStored(topic: string, date: string): StoredDailyBriefing {
  return {
    id: undefined as unknown as string,
    topic,
    date,
    generatedAt: `${date}T06:00:00.000Z`,
    stories: [
      {
        id: `${topic}-1`,
        headline: `${topic} headline`,
        summary: `${topic} summary`,
        whyItMatters: `${topic} matters`,
        keyFacts: [],
        entities: [],
        publishedAt: `${date}T05:00:00.000Z`,
        primarySource: "Reuters",
        relatedSources: [],
        articleUrls: [`https://example.com/${encodeURIComponent(topic)}`],
        confidence: "medium",
        uncertaintyNotes: [],
        sourceDisagreements: [],
        isAiGenerated: false,
        importanceScore: 0.5,
        coveredBy: "Reuters",
        verification: {
          level: "limited",
          label: "Limited reporting",
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
        change: {
          status: "new",
          stableId: "x",
          firstSeenAt: `${date}T06:00:00.000Z`,
          lastUpdatedAt: `${date}T06:00:00.000Z`,
          previousState: null,
          currentState: {
            headline: `${topic} headline`,
            summary: `${topic} summary`,
            sources: ["Reuters"],
            articleUrls: [`https://example.com/${encodeURIComponent(topic)}`],
            publishedAt: `${date}T05:00:00.000Z`,
            contentHash: "h",
          },
          changeSummary: "First",
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
          headline: `${topic} headline`,
          changeSummary: "First",
        },
      ],
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
    topDevelopments: [`${topic} headline`],
    whyItMatters: [`${topic} matters`],
  };
}

class FlakyProvider implements NotificationProvider {
  readonly name = "flaky";
  failTimes: number;
  sent: NotificationMessage[] = [];

  constructor(failTimes: number) {
    this.failTimes = failTimes;
  }

  isConfigured(): boolean {
    return true;
  }

  async send(message: NotificationMessage) {
    if (this.failTimes > 0) {
      this.failTimes -= 1;
      return { ok: false, error: "temporary failure" };
    }
    this.sent.push(message);
    return { ok: true, providerMessageId: `ok-${this.sent.length}` };
  }
}

describe("email delivery job", () => {
  beforeEach(() => {
    const dbPath = path.join(
      os.tmpdir(),
      `newspilot-email-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
    );
    process.env.DATABASE_URL = dbPath;
    process.env.NOTIFICATION_PROVIDER = "log";
    process.env.APP_BASE_URL = "http://localhost:3000";
    process.env.EMAIL_MAX_SEND_ATTEMPTS = "3";
    resetEnvForTests();
    resetDbConnectionForTests();
    migrate();
  });

  it("sends from StoredDailyBriefing without calling AI, dedupes, retries, and unsubscribes", async () => {
    const date = "2026-09-13";
    const stored = saveStoredDailyBriefing(makeStored("Space", date));
    const sub = upsertEmailSubscription("client-a", {
      email: "reader@example.com",
      timezone: "UTC",
      deliveryHour: 6,
      deliveryMinute: 0,
      topics: ["Space"],
    });

    const first = await runEmailDeliveryJob({
      now: new Date("2026-09-13T06:05:00.000Z"),
      date,
      provider: new LogEmailProvider(),
    });
    expect(first.sent).toBe(1);
    expect(first.failed).toBe(0);
    const delivery = getDeliveryForSubscriptionBriefing(sub.id, stored.id);
    expect(delivery?.status).toBe("sent");
    expect(delivery?.attemptCount).toBe(1);

    const second = await runEmailDeliveryJob({
      now: new Date("2026-09-13T07:00:00.000Z"),
      date,
      provider: new LogEmailProvider(),
    });
    expect(second.sent).toBe(0);
    expect(second.results.some((item) => item.status === "skipped_duplicate")).toBe(
      true,
    );
    expect(listEmailDeliveries({ subscriptionId: sub.id })).toHaveLength(1);

    const flaky = new FlakyProvider(1);
    const retrySub = upsertEmailSubscription("client-b", {
      email: "retry@example.com",
      timezone: "UTC",
      deliveryHour: 6,
      deliveryMinute: 0,
      topics: ["Space"],
    });
    const failPass = await runEmailDeliveryJob({
      now: new Date("2026-09-13T08:00:00.000Z"),
      date,
      provider: flaky,
    });
    expect(failPass.failed).toBe(1);
    expect(getDeliveryForSubscriptionBriefing(retrySub.id, stored.id)?.status).toBe(
      "failed",
    );

    const retryPass = await runEmailDeliveryJob({
      now: new Date("2026-09-13T08:01:00.000Z"),
      date,
      provider: flaky,
    });
    expect(retryPass.sent).toBe(1);
    expect(flaky.sent[0]?.subject).toContain("Space");
    expect(flaky.sent[0]?.text).toContain("Space summary");
    expect(flaky.sent[0]?.html).toContain("What's changed");

    unsubscribeByToken(sub.unsubscribeToken);
    const afterUnsub = await runEmailDeliveryJob({
      now: new Date("2026-09-13T09:00:00.000Z"),
      date,
      provider: new LogEmailProvider(),
      forceResend: true,
    });
    expect(
      afterUnsub.results.some(
        (item) =>
          item.subscriptionId === sub.id && item.status === "sent",
      ),
    ).toBe(false);
  });

  it("skips when local delivery time has not arrived", async () => {
    saveStoredDailyBriefing(makeStored("AI", "2026-09-13"));
    upsertEmailSubscription("client-c", {
      email: "later@example.com",
      timezone: "UTC",
      deliveryHour: 18,
      deliveryMinute: 0,
      topics: ["AI"],
    });

    const result = await runEmailDeliveryJob({
      now: new Date("2026-09-13T10:00:00.000Z"),
      date: "2026-09-13",
      provider: new LogEmailProvider(),
    });
    expect(result.sent).toBe(0);
    expect(result.results[0]?.status).toBe("skipped_not_due");
  });
});
