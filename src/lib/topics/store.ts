import { and, asc, eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { getDb } from "@/lib/db/client";
import { userTopics } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import { normalizeTopic } from "@/lib/utils/text";
import {
  isTopicFrequency,
  type TopicFrequency,
  type UserTopic,
  type UserTopicInput,
} from "@/lib/topics/types";

function nowIso(): string {
  return new Date().toISOString();
}

function mapRow(row: typeof userTopics.$inferSelect): UserTopic {
  const frequency = isTopicFrequency(row.frequency) ? row.frequency : "daily";
  return {
    id: row.id,
    clientId: row.clientId,
    topic: row.topic,
    normalizedTopic: row.normalizedTopic,
    sortOrder: row.sortOrder,
    frequency,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function listUserTopics(clientId: string): UserTopic[] {
  const db = getDb();
  const rows = db
    .select()
    .from(userTopics)
    .where(eq(userTopics.clientId, clientId))
    .orderBy(asc(userTopics.sortOrder), asc(userTopics.createdAt))
    .all();
  return rows.map(mapRow);
}

/**
 * Distinct subscribed topics across all clients, optionally filtered by frequency.
 * Used by the automatic daily briefing job.
 */
export function listDistinctSubscribedTopics(options?: {
  frequencies?: TopicFrequency[];
}): Array<{ topic: string; normalizedTopic: string; frequency: TopicFrequency }> {
  const rows = getDb().select().from(userTopics).all().map(mapRow);
  const allowed = options?.frequencies?.length
    ? new Set(options.frequencies)
    : null;

  const byNormalized = new Map<
    string,
    { topic: string; normalizedTopic: string; frequency: TopicFrequency }
  >();

  for (const row of rows) {
    if (allowed && !allowed.has(row.frequency)) continue;
    const existing = byNormalized.get(row.normalizedTopic);
    if (!existing) {
      byNormalized.set(row.normalizedTopic, {
        topic: row.topic,
        normalizedTopic: row.normalizedTopic,
        frequency: row.frequency,
      });
      continue;
    }
    // Prefer a more frequent subscription label when multiple clients differ.
    const rank = (f: TopicFrequency) =>
      f === "twice_daily" ? 0 : f === "daily" ? 1 : 2;
    if (rank(row.frequency) < rank(existing.frequency)) {
      byNormalized.set(row.normalizedTopic, {
        topic: row.topic,
        normalizedTopic: row.normalizedTopic,
        frequency: row.frequency,
      });
    }
  }

  return [...byNormalized.values()].sort((a, b) =>
    a.topic.localeCompare(b.topic),
  );
}

export function addUserTopic(
  clientId: string,
  input: UserTopicInput,
): UserTopic {
  const topic = input.topic.trim();
  if (!topic) {
    throw new AppError("Topic is required", {
      statusCode: 400,
      code: "INVALID_TOPIC",
    });
  }

  const normalized = normalizeTopic(topic);
  const frequency: TopicFrequency = input.frequency ?? "daily";
  if (!isTopicFrequency(frequency)) {
    throw new AppError("Invalid frequency", {
      statusCode: 400,
      code: "INVALID_FREQUENCY",
    });
  }

  const existing = listUserTopics(clientId);
  if (existing.some((item) => item.normalizedTopic === normalized)) {
    throw new AppError("Topic already saved", {
      statusCode: 409,
      code: "TOPIC_EXISTS",
    });
  }

  const nextOrder =
    existing.length === 0
      ? 0
      : Math.max(...existing.map((item) => item.sortOrder)) + 1;

  const row = {
    id: randomUUID(),
    clientId,
    topic,
    normalizedTopic: normalized,
    sortOrder: nextOrder,
    frequency,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  getDb().insert(userTopics).values(row).run();
  return mapRow(row);
}

export function removeUserTopic(clientId: string, topicId: string): void {
  const db = getDb();
  const result = db
    .delete(userTopics)
    .where(and(eq(userTopics.id, topicId), eq(userTopics.clientId, clientId)))
    .run();

  if (result.changes === 0) {
    throw new AppError("Topic not found", {
      statusCode: 404,
      code: "TOPIC_NOT_FOUND",
    });
  }
}

export function renameUserTopic(
  clientId: string,
  topicId: string,
  topic: string,
): UserTopic {
  const trimmed = topic.trim();
  if (!trimmed) {
    throw new AppError("Topic is required", {
      statusCode: 400,
      code: "INVALID_TOPIC",
    });
  }

  const normalized = normalizeTopic(trimmed);
  const current = getTopicForClient(clientId, topicId);
  const siblings = listUserTopics(clientId).filter((item) => item.id !== topicId);
  if (siblings.some((item) => item.normalizedTopic === normalized)) {
    throw new AppError("Topic already saved", {
      statusCode: 409,
      code: "TOPIC_EXISTS",
    });
  }

  const updatedAt = nowIso();
  getDb()
    .update(userTopics)
    .set({
      topic: trimmed,
      normalizedTopic: normalized,
      updatedAt,
    })
    .where(and(eq(userTopics.id, topicId), eq(userTopics.clientId, clientId)))
    .run();

  return { ...current, topic: trimmed, normalizedTopic: normalized, updatedAt };
}

export function setTopicFrequency(
  clientId: string,
  topicId: string,
  frequency: TopicFrequency,
): UserTopic {
  if (!isTopicFrequency(frequency)) {
    throw new AppError("Invalid frequency", {
      statusCode: 400,
      code: "INVALID_FREQUENCY",
    });
  }

  const current = getTopicForClient(clientId, topicId);
  const updatedAt = nowIso();
  getDb()
    .update(userTopics)
    .set({ frequency, updatedAt })
    .where(and(eq(userTopics.id, topicId), eq(userTopics.clientId, clientId)))
    .run();

  return { ...current, frequency, updatedAt };
}

/**
 * Reorder topics. `orderedIds` must contain every topic id for the client.
 * Position in the array becomes sortOrder (0 = highest priority).
 */
export function reorderUserTopics(
  clientId: string,
  orderedIds: string[],
): UserTopic[] {
  const existing = listUserTopics(clientId);
  if (orderedIds.length !== existing.length) {
    throw new AppError("orderedIds must include every saved topic", {
      statusCode: 400,
      code: "INVALID_REORDER",
    });
  }

  const existingIds = new Set(existing.map((item) => item.id));
  for (const id of orderedIds) {
    if (!existingIds.has(id)) {
      throw new AppError("Unknown topic id in reorder list", {
        statusCode: 400,
        code: "INVALID_REORDER",
      });
    }
  }

  const updatedAt = nowIso();
  const db = getDb();
  orderedIds.forEach((id, index) => {
    db.update(userTopics)
      .set({ sortOrder: index, updatedAt })
      .where(and(eq(userTopics.id, id), eq(userTopics.clientId, clientId)))
      .run();
  });

  return listUserTopics(clientId);
}

export function getTopicForClient(clientId: string, topicId: string): UserTopic {
  const db = getDb();
  const row = db
    .select()
    .from(userTopics)
    .where(and(eq(userTopics.id, topicId), eq(userTopics.clientId, clientId)))
    .get();

  if (!row) {
    throw new AppError("Topic not found", {
      statusCode: 404,
      code: "TOPIC_NOT_FOUND",
    });
  }

  return mapRow(row);
}

/** Priority score 1.0 for first topic, decaying toward ~0.3. */
export function topicPriorityScore(sortOrder: number, totalTopics: number): number {
  if (totalTopics <= 1) return 1;
  const t = sortOrder / Math.max(1, totalTopics - 1);
  return Math.round((1 - t * 0.7) * 10000) / 10000;
}

export function frequencyBoost(frequency: TopicFrequency): number {
  if (frequency === "twice_daily") return 1;
  if (frequency === "daily") return 0.9;
  return 0.7;
}
