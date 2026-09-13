import { getEnv } from "@/config/env";
import { migrate } from "@/lib/db/migrate";
import { getStoredDailyBriefing } from "@/lib/jobs/daily-briefing-store";
import { logger } from "@/lib/logger";
import { renderDailyBriefingEmail } from "@/lib/notifications/render-email";
import { getNotificationProvider } from "@/lib/notifications/router";
import {
  buildUnsubscribeUrl,
  isEmailDeliveryDue,
} from "@/lib/notifications/schedule";
import {
  createOrGetDeliveryAttempt,
  listActiveEmailSubscriptions,
  listEmailDeliveries,
  markDeliveryFailed,
  markDeliverySent,
} from "@/lib/notifications/subscription-store";
import type { EmailDeliveryRecord } from "@/lib/notifications/subscription-types";
import type { NotificationProvider } from "@/lib/notifications/types";
import { listUserTopics } from "@/lib/topics/store";
import { normalizeTopic } from "@/lib/utils/text";

export type EmailDeliveryAttemptResult = {
  subscriptionId: string;
  email: string;
  topic: string;
  briefingId?: string;
  status:
    | "sent"
    | "failed"
    | "skipped_duplicate"
    | "skipped_not_due"
    | "skipped_no_briefing"
    | "skipped_inactive";
  error?: string;
  deliveryId?: string;
};

export type EmailDeliveryJobResult = {
  startedAt: string;
  finishedAt: string;
  dateFilter: string | null;
  sent: number;
  failed: number;
  skipped: number;
  results: EmailDeliveryAttemptResult[];
};

export type RunEmailDeliveryOptions = {
  now?: Date;
  /** Limit to briefings for this calendar date (YYYY-MM-DD). */
  date?: string;
  /** Ignore per-subscription delivery window (still respects timezone date). */
  ignoreSchedule?: boolean;
  /** Force retry even if already sent (creates no duplicate when already sent unless forceResend). */
  forceResend?: boolean;
  provider?: NotificationProvider;
  maxAttempts?: number;
};

function topicsForSubscription(subscription: {
  clientId: string;
  topics: Array<{ topic: string }>;
}): string[] {
  if (subscription.topics.length > 0) {
    return subscription.topics.map((item) => item.topic);
  }
  return listUserTopics(subscription.clientId).map((item) => item.topic);
}

/**
 * Deliver stored DailyBriefings over email.
 * Does not call LLMs or the news pipeline — only reads StoredDailyBriefing rows.
 */
export async function runEmailDeliveryJob(
  options: RunEmailDeliveryOptions = {},
): Promise<EmailDeliveryJobResult> {
  migrate();
  const env = getEnv();
  const now = options.now ?? new Date();
  const startedAt = now.toISOString();
  const provider = getNotificationProvider(options.provider);
  const maxAttempts = options.maxAttempts ?? env.EMAIL_MAX_SEND_ATTEMPTS;

  const results: EmailDeliveryAttemptResult[] = [];
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  if (!provider.isConfigured()) {
    logger.warn("Email notification provider is not configured; skipping delivery");
    return {
      startedAt,
      finishedAt: new Date().toISOString(),
      dateFilter: options.date ?? null,
      sent: 0,
      failed: 0,
      skipped: 0,
      results: [],
    };
  }

  const subscriptions = listActiveEmailSubscriptions();

  for (const subscription of subscriptions) {
    const schedule = isEmailDeliveryDue({
      now,
      timezone: subscription.timezone,
      deliveryHour: subscription.deliveryHour,
      deliveryMinute: subscription.deliveryMinute,
    });

    if (!options.ignoreSchedule && !schedule.due) {
      skipped += 1;
      results.push({
        subscriptionId: subscription.id,
        email: subscription.email,
        topic: "*",
        status: "skipped_not_due",
      });
      continue;
    }

    const briefingDate = options.date ?? schedule.localDate;
    const topics = topicsForSubscription(subscription);

    for (const topic of topics) {
      const briefing = getStoredDailyBriefing(topic, briefingDate);
      if (!briefing) {
        skipped += 1;
        results.push({
          subscriptionId: subscription.id,
          email: subscription.email,
          topic,
          status: "skipped_no_briefing",
        });
        continue;
      }

      const delivery = createOrGetDeliveryAttempt({
        subscriptionId: subscription.id,
        briefingId: briefing.id,
        topic: briefing.topic,
        date: briefing.date,
      });

      if (delivery.status === "sent" && !options.forceResend) {
        skipped += 1;
        results.push({
          subscriptionId: subscription.id,
          email: subscription.email,
          topic: briefing.topic,
          briefingId: briefing.id,
          status: "skipped_duplicate",
          deliveryId: delivery.id,
        });
        continue;
      }

      if (
        delivery.status === "failed" &&
        delivery.attemptCount >= maxAttempts &&
        !options.forceResend
      ) {
        failed += 1;
        results.push({
          subscriptionId: subscription.id,
          email: subscription.email,
          topic: briefing.topic,
          briefingId: briefing.id,
          status: "failed",
          error: delivery.error ?? "Max send attempts reached",
          deliveryId: delivery.id,
        });
        continue;
      }

      const unsubscribeUrl = buildUnsubscribeUrl(
        env.APP_BASE_URL,
        subscription.unsubscribeToken,
      );
      const rendered = renderDailyBriefingEmail(briefing, { unsubscribeUrl });
      const correlationId = `${subscription.id}:${briefing.id}`;

      const sendResult = await provider.send({
        to: subscription.email,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
        correlationId,
        headers: {
          "List-Unsubscribe": `<${unsubscribeUrl}>`,
        },
      });

      const nextAttempt = delivery.attemptCount + 1;
      if (sendResult.ok) {
        markDeliverySent(delivery.id, {
          provider: provider.name,
          providerMessageId: sendResult.providerMessageId,
          attemptCount: nextAttempt,
        });
        sent += 1;
        results.push({
          subscriptionId: subscription.id,
          email: subscription.email,
          topic: briefing.topic,
          briefingId: briefing.id,
          status: "sent",
          deliveryId: delivery.id,
        });
        logger.info("Daily briefing email sent", {
          subscriptionId: subscription.id,
          briefingId: briefing.id,
          topic: briefing.topic,
          date: briefing.date,
          provider: provider.name,
          normalizedTopic: normalizeTopic(briefing.topic),
        });
      } else {
        markDeliveryFailed(delivery.id, {
          provider: provider.name,
          error: sendResult.error ?? "Unknown send error",
          attemptCount: nextAttempt,
        });
        failed += 1;
        results.push({
          subscriptionId: subscription.id,
          email: subscription.email,
          topic: briefing.topic,
          briefingId: briefing.id,
          status: "failed",
          error: sendResult.error,
          deliveryId: delivery.id,
        });
        logger.warn("Daily briefing email send failed", {
          subscriptionId: subscription.id,
          briefingId: briefing.id,
          attemptCount: nextAttempt,
          error: sendResult.error,
        });
      }
    }
  }

  const finishedAt = new Date().toISOString();
  logger.info("Email delivery job finished", {
    sent,
    failed,
    skipped,
    provider: provider.name,
  });

  return {
    startedAt,
    finishedAt,
    dateFilter: options.date ?? null,
    sent,
    failed,
    skipped,
    results,
  };
}

export function recentDeliveryLog(limit = 50): EmailDeliveryRecord[] {
  return listEmailDeliveries({ limit });
}
