import { getEnv } from "@/config/env";
import { logger } from "@/lib/logger";
import {
  buildBriefingForTopic,
  type BuildBriefingOptions,
} from "@/lib/pipeline/briefing";
import { processNewsForTopic } from "@/lib/pipeline/process";
import {
  completeJobLock,
  failJobLock,
  getStoredDailyBriefing,
  saveStoredDailyBriefing,
  tryAcquireJobLock,
} from "@/lib/jobs/daily-briefing-store";
import type {
  DailyBriefingGenerationStats,
  DailyBriefingJobResult,
  DailyBriefingJobTopicResult,
  StoredDailyBriefing,
} from "@/lib/jobs/types";
import {
  isTopicFrequency,
  type TopicFrequency,
} from "@/lib/topics/types";
import { listDistinctSubscribedTopics } from "@/lib/topics/store";
import { migrate } from "@/lib/db/migrate";

export type RunDailyBriefingsOptions = {
  /** Override calendar date (YYYY-MM-DD). Defaults to today in configured timezone. */
  date?: string;
  now?: Date;
  force?: boolean;
  topics?: string[];
  buildBriefing?: typeof buildBriefingForTopic;
  processNews?: typeof processNewsForTopic;
};

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * Calendar date string for the configured daily-briefing timezone.
 */
export function briefingDateForNow(
  now: Date = new Date(),
  timeZone = getEnv().DAILY_BRIEFING_TIMEZONE,
): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const day = parts.find((part) => part.type === "day")?.value;
    if (year && month && day) return `${year}-${month}-${day}`;
  } catch {
    // fall through
  }
  return `${now.getUTCFullYear()}-${pad2(now.getUTCMonth() + 1)}-${pad2(now.getUTCDate())}`;
}

export function getDailyBriefingScheduleConfig() {
  const env = getEnv();
  return {
    hour: env.DAILY_BRIEFING_HOUR,
    minute: env.DAILY_BRIEFING_MINUTE,
    timeZone: env.DAILY_BRIEFING_TIMEZONE,
    frequencies: env.DAILY_BRIEFING_FREQUENCIES.split(",")
      .map((value) => value.trim())
      .filter((value): value is TopicFrequency => isTopicFrequency(value)),
  };
}

export function dailyJobKey(date: string): string {
  return `daily-briefings:${date}`;
}

function buildTopDevelopments(stories: StoredDailyBriefing["stories"]): string[] {
  return stories.slice(0, 5).map((story) => story.headline);
}

function buildWhyItMatters(stories: StoredDailyBriefing["stories"]): string[] {
  return stories
    .map((story) => story.whyItMatters?.trim())
    .filter((value): value is string => Boolean(value))
    .slice(0, 5);
}

/**
 * Generate (or reuse) one stored daily briefing for a topic+date.
 * Idempotent: existing topic+date rows are returned without regeneration.
 */
export async function generateDailyBriefingForTopic(
  topic: string,
  date: string,
  options: {
    now?: Date;
    force?: boolean;
    buildBriefing?: typeof buildBriefingForTopic;
    processNews?: typeof processNewsForTopic;
  } = {},
): Promise<{
  briefing: StoredDailyBriefing;
  created: boolean;
}> {
  const existing = getStoredDailyBriefing(topic, date);
  if (existing && !options.force) {
    logger.info("Daily briefing already stored; skipping generation", {
      topic,
      date,
      briefingId: existing.id,
    });
    return { briefing: existing, created: false };
  }

  const started = Date.now();
  const now = options.now ?? new Date();
  const buildBriefing = options.buildBriefing ?? buildBriefingForTopic;
  const processNews = options.processNews ?? processNewsForTopic;

  let articlesRetrieved = 0;
  let duplicateArticlesRemoved = 0;
  let storyClustersCreated = 0;

  const briefingOptions: BuildBriefingOptions = {
    forceRefresh: true,
    now,
    processNews: async (topicName, processOptions) => {
      const processed = await processNews(topicName, processOptions);
      articlesRetrieved = processed.dedupeStats.inputCount;
      duplicateArticlesRemoved =
        processed.dedupeStats.exactUrlDuplicatesRemoved +
        processed.dedupeStats.nearDuplicatesRemoved +
        processed.dedupeStats.duplicateArticlesCollapsed;
      storyClustersCreated = processed.dedupeStats.clusterCount;
      return processed;
    },
  };

  const live = await buildBriefing(topic, briefingOptions);

  const generationStats: DailyBriefingGenerationStats = {
    articlesRetrieved,
    duplicateArticlesRemoved,
    storyClustersCreated,
    aiCalls: live.llmCalls,
    cachedSummaries: live.summaryCacheHits,
    generationDurationMs: Date.now() - started,
  };

  const stored = saveStoredDailyBriefing(
    {
      topic: live.topic,
      date,
      generatedAt: live.generatedAt,
      stories: live.stories,
      changes: live.whatsNew,
      generationStats,
      warnings: live.warnings,
      topDevelopments: buildTopDevelopments(live.stories),
      whyItMatters: buildWhyItMatters(live.stories),
    },
    { replace: Boolean(options.force) },
  );

  logger.info("Stored daily briefing", {
    topic: stored.topic,
    date: stored.date,
    briefingId: stored.id,
    ...generationStats,
    newCount: stored.changes.newCount,
    updatedCount: stored.changes.updatedCount,
    ongoingCount: stored.changes.ongoingCount,
  });

  return { briefing: stored, created: true };
}

/**
 * Scheduled / manual job: generate daily briefings for subscribed topics.
 * Prevents duplicate concurrent/same-day runs via job_runs lock.
 */
export async function runDailyBriefingsJob(
  options: RunDailyBriefingsOptions = {},
): Promise<DailyBriefingJobResult> {
  migrate();
  const now = options.now ?? new Date();
  const date = options.date ?? briefingDateForNow(now);
  const jobKey = dailyJobKey(date);
  const startedAt = now.toISOString();
  const schedule = getDailyBriefingScheduleConfig();

  logger.info("Daily briefings job starting", {
    jobKey,
    date,
    scheduleHour: schedule.hour,
    scheduleMinute: schedule.minute,
    timeZone: schedule.timeZone,
    frequencies: schedule.frequencies,
  });

  if (!options.force) {
    const acquired = tryAcquireJobLock(jobKey, startedAt);
    if (!acquired) {
      const skipped: DailyBriefingJobResult = {
        jobKey,
        date,
        startedAt,
        finishedAt: new Date().toISOString(),
        status: "skipped_duplicate_job",
        topicsProcessed: 0,
        topicsCreated: 0,
        topicsSkipped: 0,
        topicsFailed: 0,
        results: [],
        error: "Job already running or completed for this date",
      };
      logger.warn("Daily briefings job skipped (duplicate)", { jobKey, date });
      return skipped;
    }
  } else {
    // Force path still records a distinct lock key suffix to avoid blocking audits.
    tryAcquireJobLock(`${jobKey}:force:${Date.now()}`, startedAt);
  }

  const topics = options.topics?.length
    ? options.topics.map((topic) => ({
        topic,
        normalizedTopic: topic,
        frequency: "daily" as const,
      }))
    : listDistinctSubscribedTopics({ frequencies: schedule.frequencies });

  const results: DailyBriefingJobTopicResult[] = [];
  let topicsCreated = 0;
  let topicsSkipped = 0;
  let topicsFailed = 0;

  try {
    for (const item of topics) {
      try {
        const { briefing, created } = await generateDailyBriefingForTopic(
          item.topic,
          date,
          {
            now,
            force: options.force,
            buildBriefing: options.buildBriefing,
            processNews: options.processNews,
          },
        );
        if (created) {
          topicsCreated += 1;
          results.push({
            topic: item.topic,
            status: "created",
            briefingId: briefing.id,
            generationStats: briefing.generationStats,
          });
        } else {
          topicsSkipped += 1;
          results.push({
            topic: item.topic,
            status: "skipped_existing",
            briefingId: briefing.id,
            generationStats: briefing.generationStats,
          });
        }
      } catch (error) {
        topicsFailed += 1;
        const message = error instanceof Error ? error.message : String(error);
        results.push({
          topic: item.topic,
          status: "failed",
          error: message,
        });
        logger.error("Daily briefing topic failed", {
          topic: item.topic,
          date,
          error: message,
        });
      }
    }

    const finishedAt = new Date().toISOString();
    const result: DailyBriefingJobResult = {
      jobKey,
      date,
      startedAt,
      finishedAt,
      status: "completed",
      topicsProcessed: topics.length,
      topicsCreated,
      topicsSkipped,
      topicsFailed,
      results,
    };

    if (!options.force) {
      completeJobLock(jobKey, result);
    }

    logger.info("Daily briefings job completed", {
      jobKey,
      date,
      topicsProcessed: result.topicsProcessed,
      topicsCreated,
      topicsSkipped,
      topicsFailed,
      durationMs: Date.parse(finishedAt) - Date.parse(startedAt),
    });

    return result;
  } catch (error) {
    const finishedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : String(error);
    if (!options.force) {
      failJobLock(jobKey, finishedAt, message);
    }
    logger.error("Daily briefings job failed", { jobKey, date, error: message });
    return {
      jobKey,
      date,
      startedAt,
      finishedAt,
      status: "failed",
      topicsProcessed: topics.length,
      topicsCreated,
      topicsSkipped,
      topicsFailed,
      results,
      error: message,
    };
  }
}
