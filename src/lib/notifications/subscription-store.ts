import { and, desc, eq } from "drizzle-orm";
import { randomBytes, randomUUID } from "crypto";
import { getDb } from "@/lib/db/client";
import {
  emailDeliveries,
  emailSubscriptionTopics,
  emailSubscriptions,
} from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import { normalizeTopic } from "@/lib/utils/text";
import type {
  EmailDeliveryRecord,
  EmailDeliveryStatus,
  EmailSubscription,
  EmailSubscriptionTopic,
  UpsertEmailSubscriptionInput,
} from "@/lib/notifications/subscription-types";

function mapTopicRow(
  row: typeof emailSubscriptionTopics.$inferSelect,
): EmailSubscriptionTopic {
  return {
    id: row.id,
    topic: row.topic,
    normalizedTopic: row.normalizedTopic,
  };
}

function mapSubscriptionRow(
  row: typeof emailSubscriptions.$inferSelect,
  topics: EmailSubscriptionTopic[],
): EmailSubscription {
  return {
    id: row.id,
    clientId: row.clientId,
    email: row.email,
    timezone: row.timezone,
    deliveryHour: row.deliveryHour,
    deliveryMinute: row.deliveryMinute,
    active: row.active,
    unsubscribeToken: row.unsubscribeToken,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    unsubscribedAt: row.unsubscribedAt,
    topics,
  };
}

function mapDeliveryRow(
  row: typeof emailDeliveries.$inferSelect,
): EmailDeliveryRecord {
  return {
    id: row.id,
    subscriptionId: row.subscriptionId,
    briefingId: row.briefingId,
    topic: row.topic,
    date: row.date,
    status: row.status as EmailDeliveryStatus,
    attemptCount: row.attemptCount,
    lastAttemptAt: row.lastAttemptAt,
    provider: row.provider,
    providerMessageId: row.providerMessageId,
    error: row.error,
    createdAt: row.createdAt,
    sentAt: row.sentAt,
  };
}

function loadTopicsForSubscription(subscriptionId: string): EmailSubscriptionTopic[] {
  return getDb()
    .select()
    .from(emailSubscriptionTopics)
    .where(eq(emailSubscriptionTopics.subscriptionId, subscriptionId))
    .all()
    .map(mapTopicRow);
}

function newUnsubscribeToken(): string {
  return randomBytes(24).toString("hex");
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function assertEmail(email: string): string {
  const normalized = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new AppError("Invalid email address", {
      statusCode: 400,
      code: "INVALID_EMAIL",
    });
  }
  return normalized;
}

function assertDeliveryTime(hour: number, minute: number): void {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new AppError("deliveryHour must be 0–23", {
      statusCode: 400,
      code: "INVALID_DELIVERY_HOUR",
    });
  }
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new AppError("deliveryMinute must be 0–59", {
      statusCode: 400,
      code: "INVALID_DELIVERY_MINUTE",
    });
  }
}

function replaceSubscriptionTopics(
  subscriptionId: string,
  topics: string[],
): EmailSubscriptionTopic[] {
  getDb()
    .delete(emailSubscriptionTopics)
    .where(eq(emailSubscriptionTopics.subscriptionId, subscriptionId))
    .run();

  const seen = new Set<string>();
  const inserted: EmailSubscriptionTopic[] = [];
  for (const topic of topics) {
    const trimmed = topic.trim();
    if (!trimmed) continue;
    const normalized = normalizeTopic(trimmed);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    const row = {
      id: randomUUID(),
      subscriptionId,
      topic: trimmed,
      normalizedTopic: normalized,
    };
    getDb().insert(emailSubscriptionTopics).values(row).run();
    inserted.push(mapTopicRow(row));
  }
  return inserted;
}

export function getEmailSubscriptionForClient(
  clientId: string,
): EmailSubscription | null {
  const row = getDb()
    .select()
    .from(emailSubscriptions)
    .where(eq(emailSubscriptions.clientId, clientId))
    .get();
  if (!row) return null;
  return mapSubscriptionRow(row, loadTopicsForSubscription(row.id));
}

export function getEmailSubscriptionByToken(
  token: string,
): EmailSubscription | null {
  const row = getDb()
    .select()
    .from(emailSubscriptions)
    .where(eq(emailSubscriptions.unsubscribeToken, token))
    .get();
  if (!row) return null;
  return mapSubscriptionRow(row, loadTopicsForSubscription(row.id));
}

export function listActiveEmailSubscriptions(): EmailSubscription[] {
  return getDb()
    .select()
    .from(emailSubscriptions)
    .where(eq(emailSubscriptions.active, true))
    .all()
    .map((row) => mapSubscriptionRow(row, loadTopicsForSubscription(row.id)));
}

export function upsertEmailSubscription(
  clientId: string,
  input: UpsertEmailSubscriptionInput,
): EmailSubscription {
  const email = assertEmail(input.email);
  const deliveryHour = input.deliveryHour ?? 6;
  const deliveryMinute = input.deliveryMinute ?? 0;
  assertDeliveryTime(deliveryHour, deliveryMinute);
  const timezone = (input.timezone ?? "UTC").trim() || "UTC";
  const now = new Date().toISOString();

  const existing = getEmailSubscriptionForClient(clientId);
  if (existing) {
    const emailOwner = getDb()
      .select()
      .from(emailSubscriptions)
      .where(eq(emailSubscriptions.email, email))
      .get();
    if (emailOwner && emailOwner.clientId !== clientId) {
      throw new AppError("That email is already subscribed on another client", {
        statusCode: 409,
        code: "EMAIL_IN_USE",
      });
    }

    const active = input.active ?? true;
    getDb()
      .update(emailSubscriptions)
      .set({
        email,
        timezone,
        deliveryHour,
        deliveryMinute,
        active,
        updatedAt: now,
        unsubscribedAt: active ? null : now,
      })
      .where(eq(emailSubscriptions.id, existing.id))
      .run();

    const topics =
      input.topics !== undefined
        ? replaceSubscriptionTopics(existing.id, input.topics)
        : loadTopicsForSubscription(existing.id);

    return {
      ...existing,
      email,
      timezone,
      deliveryHour,
      deliveryMinute,
      active,
      updatedAt: now,
      unsubscribedAt: active ? null : now,
      topics,
    };
  }

  const id = randomUUID();
  const unsubscribeToken = newUnsubscribeToken();
  getDb()
    .insert(emailSubscriptions)
    .values({
      id,
      clientId,
      email,
      timezone,
      deliveryHour,
      deliveryMinute,
      active: input.active ?? true,
      unsubscribeToken,
      createdAt: now,
      updatedAt: now,
      unsubscribedAt: null,
    })
    .run();

  const topics = replaceSubscriptionTopics(id, input.topics ?? []);
  return {
    id,
    clientId,
    email,
    timezone,
    deliveryHour,
    deliveryMinute,
    active: input.active ?? true,
    unsubscribeToken,
    createdAt: now,
    updatedAt: now,
    unsubscribedAt: null,
    topics,
  };
}

export function unsubscribeByToken(token: string): EmailSubscription {
  const existing = getEmailSubscriptionByToken(token);
  if (!existing) {
    throw new AppError("Unsubscribe link is invalid or expired", {
      statusCode: 404,
      code: "UNSUBSCRIBE_NOT_FOUND",
    });
  }
  const now = new Date().toISOString();
  getDb()
    .update(emailSubscriptions)
    .set({
      active: false,
      unsubscribedAt: now,
      updatedAt: now,
    })
    .where(eq(emailSubscriptions.id, existing.id))
    .run();
  return {
    ...existing,
    active: false,
    unsubscribedAt: now,
    updatedAt: now,
  };
}

export function unsubscribeForClient(clientId: string): EmailSubscription | null {
  const existing = getEmailSubscriptionForClient(clientId);
  if (!existing) return null;
  const now = new Date().toISOString();
  getDb()
    .update(emailSubscriptions)
    .set({
      active: false,
      unsubscribedAt: now,
      updatedAt: now,
    })
    .where(eq(emailSubscriptions.id, existing.id))
    .run();
  return {
    ...existing,
    active: false,
    unsubscribedAt: now,
    updatedAt: now,
  };
}

export function getDeliveryForSubscriptionBriefing(
  subscriptionId: string,
  briefingId: string,
): EmailDeliveryRecord | null {
  const row = getDb()
    .select()
    .from(emailDeliveries)
    .where(
      and(
        eq(emailDeliveries.subscriptionId, subscriptionId),
        eq(emailDeliveries.briefingId, briefingId),
      ),
    )
    .get();
  return row ? mapDeliveryRow(row) : null;
}

export function listEmailDeliveries(options?: {
  subscriptionId?: string;
  date?: string;
  limit?: number;
}): EmailDeliveryRecord[] {
  const limit = options?.limit ?? 50;
  let rows = getDb()
    .select()
    .from(emailDeliveries)
    .orderBy(desc(emailDeliveries.createdAt))
    .all();

  if (options?.subscriptionId) {
    rows = rows.filter((row) => row.subscriptionId === options.subscriptionId);
  }
  if (options?.date) {
    rows = rows.filter((row) => row.date === options.date);
  }
  return rows.slice(0, limit).map(mapDeliveryRow);
}

export function createOrGetDeliveryAttempt(input: {
  subscriptionId: string;
  briefingId: string;
  topic: string;
  date: string;
}): EmailDeliveryRecord {
  const existing = getDeliveryForSubscriptionBriefing(
    input.subscriptionId,
    input.briefingId,
  );
  if (existing) return existing;

  const now = new Date().toISOString();
  const row = {
    id: randomUUID(),
    subscriptionId: input.subscriptionId,
    briefingId: input.briefingId,
    topic: input.topic,
    date: input.date,
    status: "pending" as const,
    attemptCount: 0,
    lastAttemptAt: null,
    provider: null,
    providerMessageId: null,
    error: null,
    createdAt: now,
    sentAt: null,
  };

  try {
    getDb().insert(emailDeliveries).values(row).run();
    return mapDeliveryRow(row);
  } catch {
    const raced = getDeliveryForSubscriptionBriefing(
      input.subscriptionId,
      input.briefingId,
    );
    if (raced) return raced;
    throw new AppError("Failed to create delivery log row", {
      statusCode: 500,
      code: "DELIVERY_LOG_FAILED",
    });
  }
}

export function markDeliverySent(
  id: string,
  meta: {
    provider: string;
    providerMessageId?: string;
    attemptCount: number;
  },
): void {
  const now = new Date().toISOString();
  getDb()
    .update(emailDeliveries)
    .set({
      status: "sent",
      provider: meta.provider,
      providerMessageId: meta.providerMessageId ?? null,
      error: null,
      sentAt: now,
      lastAttemptAt: now,
      attemptCount: meta.attemptCount,
    })
    .where(eq(emailDeliveries.id, id))
    .run();
}

export function markDeliveryFailed(
  id: string,
  meta: { provider: string; error: string; attemptCount: number },
): void {
  const now = new Date().toISOString();
  getDb()
    .update(emailDeliveries)
    .set({
      status: "failed",
      provider: meta.provider,
      error: meta.error,
      lastAttemptAt: now,
      attemptCount: meta.attemptCount,
    })
    .where(eq(emailDeliveries.id, id))
    .run();
}

export function markDeliverySkipped(
  id: string,
  status: Extract<
    EmailDeliveryStatus,
    | "skipped_duplicate"
    | "skipped_inactive"
    | "skipped_no_briefing"
    | "skipped_not_due"
  >,
  error?: string,
): void {
  getDb()
    .update(emailDeliveries)
    .set({
      status,
      error: error ?? null,
      lastAttemptAt: new Date().toISOString(),
    })
    .where(eq(emailDeliveries.id, id))
    .run();
}
