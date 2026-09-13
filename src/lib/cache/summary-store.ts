import { and, eq, gt, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { summaryCacheEntries } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import type { StorySummary } from "@/types/briefing";

/**
 * Durable AI summary cache keyed by provider + content hash.
 * Survives process restarts so daily jobs / cold starts reuse valid summaries.
 */
export function getDurableSummary(
  provider: string,
  contentHash: string,
): StorySummary | null {
  try {
    const nowIso = new Date().toISOString();
    const row = getDb()
      .select()
      .from(summaryCacheEntries)
      .where(
        and(
          eq(summaryCacheEntries.provider, provider),
          eq(summaryCacheEntries.contentHash, contentHash),
          gt(summaryCacheEntries.expiresAt, nowIso),
        ),
      )
      .get();
    if (!row) return null;
    return JSON.parse(row.payloadJson) as StorySummary;
  } catch (error) {
    logger.warn("Durable summary cache read failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export function setDurableSummary(args: {
  provider: string;
  contentHash: string;
  summary: StorySummary;
  ttlSeconds: number;
}): void {
  try {
    const now = Date.now();
    const expiresAt = new Date(now + args.ttlSeconds * 1000).toISOString();
    const createdAt = new Date(now).toISOString();
    const id = `${args.provider}:${args.contentHash}`;
    const payloadJson = JSON.stringify({
      ...args.summary,
      cached: true,
    });
    const db = getDb();
    db.delete(summaryCacheEntries).where(eq(summaryCacheEntries.id, id)).run();
    db.insert(summaryCacheEntries)
      .values({
        id,
        provider: args.provider,
        contentHash: args.contentHash,
        payloadJson,
        createdAt,
        expiresAt,
      })
      .run();
  } catch (error) {
    logger.warn("Durable summary cache write failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function pruneExpiredDurableSummaries(limit = 200): number {
  try {
    const result = getDb().run(
      sql`DELETE FROM summary_cache WHERE id IN (
        SELECT id FROM summary_cache WHERE expires_at < datetime('now') LIMIT ${limit}
      )`,
    );
    return Number(result.changes ?? 0);
  } catch {
    return 0;
  }
}

export function countDurableSummaries(): number {
  try {
    const row = getDb()
      .select({ count: sql<number>`count(*)` })
      .from(summaryCacheEntries)
      .get();
    return Number(row?.count ?? 0);
  } catch {
    return 0;
  }
}
