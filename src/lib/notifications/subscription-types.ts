export type EmailSubscriptionTopic = {
  id: string;
  topic: string;
  normalizedTopic: string;
};

export type EmailSubscription = {
  id: string;
  clientId: string;
  email: string;
  timezone: string;
  deliveryHour: number;
  deliveryMinute: number;
  active: boolean;
  unsubscribeToken: string;
  createdAt: string;
  updatedAt: string;
  unsubscribedAt: string | null;
  topics: EmailSubscriptionTopic[];
};

export type EmailDeliveryStatus =
  | "pending"
  | "sent"
  | "failed"
  | "skipped_duplicate"
  | "skipped_inactive"
  | "skipped_no_briefing"
  | "skipped_not_due";

export type EmailDeliveryRecord = {
  id: string;
  subscriptionId: string;
  briefingId: string;
  topic: string;
  date: string;
  status: EmailDeliveryStatus;
  attemptCount: number;
  lastAttemptAt: string | null;
  provider: string | null;
  providerMessageId: string | null;
  error: string | null;
  createdAt: string;
  sentAt: string | null;
};

export type UpsertEmailSubscriptionInput = {
  email: string;
  timezone?: string;
  deliveryHour?: number;
  deliveryMinute?: number;
  /** Topic display names to include; empty = all current user topics at send time. */
  topics?: string[];
  active?: boolean;
};
