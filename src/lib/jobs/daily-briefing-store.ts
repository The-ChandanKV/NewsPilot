import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { getDb } from "@/lib/db/client";
import { jobRuns, storedDailyBriefings } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import { normalizeTopic } from "@/lib/utils/text";
import type {
  DailyBriefingGenerationStats,
  DailyBriefingJobResult,
  StoredDailyBriefing,
} from "@/lib/jobs/types";
import type { DailyBriefingStory, WhatsNewSummary } from "@/types/briefing";

function mapRow(row: typeof storedDailyBriefings.$inferSelect): StoredDailyBriefing {
  return {
    id: row.id,
    topic: row.topic,
    date: row.date,
    generatedAt: row.generatedAt,
    stories: JSON.parse(row.storiesJson) as DailyBriefingStory[],
    changes: JSON.parse(row.changesJson) as WhatsNewSummary,
    generationStats: JSON.parse(row.statsJson) as DailyBriefingGenerationStats,
    warnings: JSON.parse(row.warningsJson) as string[],
    topDevelopments: JSON.parse(row.topDevelopmentsJson) as string[],
    whyItMatters: JSON.parse(row.whyItMattersJson) as string[],
  };
}

export function getStoredDailyBriefing(
  topic: string,
  date: string,
): StoredDailyBriefing | null {
  const row = getDb()
    .select()
    .from(storedDailyBriefings)
    .where(
      and(
        eq(storedDailyBriefings.normalizedTopic, normalizeTopic(topic)),
        eq(storedDailyBriefings.date, date),
      ),
    )
    .get();
  return row ? mapRow(row) : null;
}

export function getStoredDailyBriefingById(id: string): StoredDailyBriefing | null {
  const row = getDb()
    .select()
    .from(storedDailyBriefings)
    .where(eq(storedDailyBriefings.id, id))
    .get();
  return row ? mapRow(row) : null;
}

export function listStoredDailyBriefings(options?: {
  date?: string;
  limit?: number;
}): StoredDailyBriefing[] {
  const db = getDb();
  const limit = options?.limit ?? 50;
  if (options?.date) {
    return db
      .select()
      .from(storedDailyBriefings)
      .where(eq(storedDailyBriefings.date, options.date))
      .orderBy(desc(storedDailyBriefings.generatedAt))
      .limit(limit)
      .all()
      .map(mapRow);
  }
  return db
    .select()
    .from(storedDailyBriefings)
    .orderBy(desc(storedDailyBriefings.generatedAt))
    .limit(limit)
    .all()
    .map(mapRow);
}

export function saveStoredDailyBriefing(
  briefing: Omit<StoredDailyBriefing, "id"> & { id?: string },
  options?: { replace?: boolean },
): StoredDailyBriefing {
  const existing = getStoredDailyBriefing(briefing.topic, briefing.date);
  if (existing && !options?.replace) {
    return existing;
  }

  if (existing && options?.replace) {
    getDb()
      .delete(storedDailyBriefings)
      .where(eq(storedDailyBriefings.id, existing.id))
      .run();
  }

  const row = {
    id: briefing.id ?? randomUUID(),
    topic: briefing.topic,
    normalizedTopic: normalizeTopic(briefing.topic),
    date: briefing.date,
    generatedAt: briefing.generatedAt,
    storiesJson: JSON.stringify(briefing.stories),
    changesJson: JSON.stringify(briefing.changes),
    statsJson: JSON.stringify(briefing.generationStats),
    warningsJson: JSON.stringify(briefing.warnings ?? []),
    topDevelopmentsJson: JSON.stringify(briefing.topDevelopments ?? []),
    whyItMattersJson: JSON.stringify(briefing.whyItMatters ?? []),
  };

  try {
    getDb().insert(storedDailyBriefings).values(row).run();
  } catch (error) {
    // Race: another worker inserted the same topic+date.
    const raced = getStoredDailyBriefing(briefing.topic, briefing.date);
    if (raced) return raced;
    throw error;
  }

  return mapRow(row);
}

export type JobRunStatus = "running" | "completed" | "failed";

/**
 * Acquire an exclusive job lock. Returns false if the job already ran/is running.
 */
export function tryAcquireJobLock(jobKey: string, startedAt: string): boolean {
  try {
    getDb()
      .insert(jobRuns)
      .values({
        jobKey,
        status: "running",
        startedAt,
        finishedAt: null,
        resultJson: null,
        error: null,
      })
      .run();
    return true;
  } catch {
    return false;
  }
}

export function completeJobLock(
  jobKey: string,
  result: DailyBriefingJobResult,
): void {
  getDb()
    .update(jobRuns)
    .set({
      status: "completed",
      finishedAt: result.finishedAt,
      resultJson: JSON.stringify(result),
      error: null,
    })
    .where(eq(jobRuns.jobKey, jobKey))
    .run();
}

export function failJobLock(jobKey: string, finishedAt: string, error: string): void {
  getDb()
    .update(jobRuns)
    .set({
      status: "failed",
      finishedAt,
      error,
    })
    .where(eq(jobRuns.jobKey, jobKey))
    .run();
}

export function getJobRun(jobKey: string) {
  return getDb().select().from(jobRuns).where(eq(jobRuns.jobKey, jobKey)).get();
}

export function requireJobSecret(provided: string | null, expected?: string): void {
  if (!expected) {
    if (process.env.NODE_ENV === "production") {
      throw new AppError("Job secret is not configured", {
        statusCode: 503,
        code: "JOB_SECRET_REQUIRED",
      });
    }
    return;
  }
  if (!provided || provided !== expected) {
    throw new AppError("Unauthorized daily job request", {
      statusCode: 401,
      code: "UNAUTHORIZED_JOB",
    });
  }
}
