import { desc, gte } from "drizzle-orm";
import { randomUUID } from "crypto";
import { getDb } from "@/lib/db/client";
import { pipelineAnalyticsEvents } from "@/lib/db/schema";
import type {
  PipelineAnalyticsEvent,
  PipelineAnalyticsEventKind,
} from "@/lib/analytics/types";

const SECRETISH =
  /\b(api[_-]?key|secret|token|password|authorization|bearer)\b/i;
const KEY_VALUE_SECRET =
  /\b(api[_-]?key|secret|token|password|authorization)\s*[:=]\s*["']?[^\s"',}]+/gi;
const BEARER = /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi;

/**
 * Strip anything that looks like a credential from analytics detail strings.
 */
export function sanitizeAnalyticsDetail(value: string | undefined | null): string | null {
  if (!value) return null;
  let cleaned = value.replace(BEARER, "Bearer [redacted]");
  cleaned = cleaned.replace(KEY_VALUE_SECRET, "$1=[redacted]");
  if (SECRETISH.test(cleaned) && /[A-Za-z0-9_\-]{20,}/.test(cleaned)) {
    cleaned = cleaned.replace(/[A-Za-z0-9_\-]{20,}/g, "[redacted]");
  }
  return cleaned.slice(0, 280);
}

function mapRow(
  row: typeof pipelineAnalyticsEvents.$inferSelect,
): PipelineAnalyticsEvent {
  let meta: Record<string, unknown> = {};
  try {
    meta = JSON.parse(row.metaJson) as Record<string, unknown>;
  } catch {
    meta = {};
  }
  return {
    id: row.id,
    kind: row.kind as PipelineAnalyticsEventKind,
    createdAt: row.createdAt,
    topic: row.topic,
    provider: row.provider,
    code: row.code,
    detail: row.detail,
    meta,
  };
}

export function recordAnalyticsEvent(input: {
  kind: PipelineAnalyticsEventKind;
  topic?: string;
  provider?: string;
  code?: string;
  detail?: string;
  meta?: Record<string, unknown>;
  createdAt?: string;
}): void {
  try {
    const safeMeta: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input.meta ?? {})) {
      if (SECRETISH.test(key)) continue;
      if (typeof value === "string") {
        safeMeta[key] = sanitizeAnalyticsDetail(value);
      } else if (
        typeof value === "number" ||
        typeof value === "boolean" ||
        value === null
      ) {
        safeMeta[key] = value;
      }
    }

    getDb()
      .insert(pipelineAnalyticsEvents)
      .values({
        id: randomUUID(),
        kind: input.kind,
        createdAt: input.createdAt ?? new Date().toISOString(),
        topic: input.topic?.slice(0, 120) ?? null,
        provider: input.provider?.slice(0, 80) ?? null,
        code: input.code?.slice(0, 120) ?? null,
        detail: sanitizeAnalyticsDetail(input.detail),
        metaJson: JSON.stringify(safeMeta),
      })
      .run();
  } catch {
    // Analytics must never break the news pipeline.
  }
}

export function listAnalyticsEvents(options?: {
  sinceIso?: string;
  limit?: number;
}): PipelineAnalyticsEvent[] {
  const limit = options?.limit ?? 500;
  const since = options?.sinceIso;
  const rows = since
    ? getDb()
        .select()
        .from(pipelineAnalyticsEvents)
        .where(gte(pipelineAnalyticsEvents.createdAt, since))
        .orderBy(desc(pipelineAnalyticsEvents.createdAt))
        .limit(limit)
        .all()
    : getDb()
        .select()
        .from(pipelineAnalyticsEvents)
        .orderBy(desc(pipelineAnalyticsEvents.createdAt))
        .limit(limit)
        .all();
  return rows.map(mapRow);
}
