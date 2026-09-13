import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const briefingRequests = sqliteTable("briefing_requests", {
  id: text("id").primaryKey(),
  topic: text("topic").notNull(),
  normalizedTopic: text("normalized_topic").notNull(),
  forceRefresh: integer("force_refresh", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const briefings = sqliteTable("briefings", {
  id: text("id").primaryKey(),
  requestId: text("request_id").references(() => briefingRequests.id),
  topic: text("topic").notNull(),
  generatedAt: text("generated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  providerUsed: text("provider_used"),
  llmCalls: integer("llm_calls").notNull().default(0),
  storyCount: integer("story_count").notNull().default(0),
  cacheExpiresAt: text("cache_expires_at"),
  payloadJson: text("payload_json"),
});

export const briefingStories = sqliteTable("briefing_stories", {
  id: text("id").primaryKey(),
  briefingId: text("briefing_id")
    .notNull()
    .references(() => briefings.id),
  rank: integer("rank").notNull(),
  headline: text("headline").notNull(),
  summary: text("summary").notNull(),
  whyItMatters: text("why_it_matters").notNull(),
  factsJson: text("facts_json").notNull().default("[]"),
  conflictsJson: text("conflicts_json").notNull().default("[]"),
  confidence: text("confidence").notNull().default("medium"),
  publishedAt: text("published_at"),
  primaryUrl: text("primary_url").notNull(),
  primarySource: text("primary_source").notNull(),
  relatedSourcesJson: text("related_sources_json").notNull().default("[]"),
  isAiGenerated: integer("is_ai_generated", { mode: "boolean" }).notNull().default(false),
});

/**
 * Anonymous per-browser topic preferences (no auth yet).
 * Scoped by opaque client_id cookie.
 */
export const userTopics = sqliteTable(
  "user_topics",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull(),
    topic: text("topic").notNull(),
    normalizedTopic: text("normalized_topic").notNull(),
    /** Lower = higher priority in personalized feed ranking. */
    sortOrder: integer("sort_order").notNull().default(0),
    /** How often the user wants this topic refreshed. */
    frequency: text("frequency").notNull().default("daily"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    clientNormalizedUnique: uniqueIndex("user_topics_client_normalized_uid").on(
      table.clientId,
      table.normalizedTopic,
    ),
  }),
);

/** Topic search / briefing reopen history (lightweight; no full article bodies). */
export const searchHistory = sqliteTable(
  "search_history",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull(),
    topic: text("topic").notNull(),
    normalizedTopic: text("normalized_topic").notNull(),
    storyCount: integer("story_count").notNull().default(0),
    lastBriefingAt: text("last_briefing_at"),
    searchedAt: text("searched_at").notNull(),
  },
  (table) => ({
    clientNormalizedUnique: uniqueIndex("search_history_client_normalized_uid").on(
      table.clientId,
      table.normalizedTopic,
    ),
  }),
);

/**
 * Saved story bookmarks. Stores display fields only — not full article HTML/body.
 * storyRefId references the cluster/story id when available.
 */
export const savedStories = sqliteTable(
  "saved_stories",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull(),
    storyRefId: text("story_ref_id").notNull(),
    headline: text("headline").notNull(),
    summary: text("summary").notNull(),
    source: text("source").notNull(),
    url: text("url").notNull(),
    topic: text("topic").notNull(),
    savedAt: text("saved_at").notNull(),
  },
  (table) => ({
    clientStoryUnique: uniqueIndex("saved_stories_client_ref_uid").on(
      table.clientId,
      table.storyRefId,
    ),
  }),
);

/** Recently opened stories — refs + display metadata only. */
export const recentlyViewedStories = sqliteTable(
  "recently_viewed_stories",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull(),
    storyRefId: text("story_ref_id").notNull(),
    headline: text("headline").notNull(),
    source: text("source").notNull(),
    url: text("url").notNull(),
    topic: text("topic").notNull(),
    viewedAt: text("viewed_at").notNull(),
  },
  (table) => ({
    clientStoryUnique: uniqueIndex("recently_viewed_client_ref_uid").on(
      table.clientId,
      table.storyRefId,
    ),
  }),
);

/** Durable topic snapshots for change detection across process restarts. */
export const topicSnapshots = sqliteTable("topic_snapshots", {
  normalizedTopic: text("normalized_topic").primaryKey(),
  topic: text("topic").notNull(),
  generatedAt: text("generated_at").notNull(),
  payloadJson: text("payload_json").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * Stored automatic daily briefings (one per topic per calendar date).
 */
export const storedDailyBriefings = sqliteTable(
  "stored_daily_briefings",
  {
    id: text("id").primaryKey(),
    topic: text("topic").notNull(),
    normalizedTopic: text("normalized_topic").notNull(),
    date: text("date").notNull(),
    generatedAt: text("generated_at").notNull(),
    storiesJson: text("stories_json").notNull(),
    changesJson: text("changes_json").notNull(),
    statsJson: text("stats_json").notNull(),
    warningsJson: text("warnings_json").notNull().default("[]"),
    topDevelopmentsJson: text("top_developments_json").notNull().default("[]"),
    whyItMattersJson: text("why_it_matters_json").notNull().default("[]"),
  },
  (table) => ({
    topicDateUnique: uniqueIndex("stored_daily_briefings_topic_date_uid").on(
      table.normalizedTopic,
      table.date,
    ),
  }),
);

/** Job run locks / audit for idempotent scheduled work. */
export const jobRuns = sqliteTable("job_runs", {
  jobKey: text("job_key").primaryKey(),
  status: text("status").notNull(),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  resultJson: text("result_json"),
  error: text("error"),
});

/**
 * Daily news email subscriptions (delivery prefs + unsubscribe token).
 * Independent of news retrieval / AI generation.
 */
export const emailSubscriptions = sqliteTable(
  "email_subscriptions",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull(),
    email: text("email").notNull(),
    timezone: text("timezone").notNull().default("UTC"),
    deliveryHour: integer("delivery_hour").notNull().default(6),
    deliveryMinute: integer("delivery_minute").notNull().default(0),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    unsubscribeToken: text("unsubscribe_token").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    unsubscribedAt: text("unsubscribed_at"),
  },
  (table) => ({
    clientUnique: uniqueIndex("email_subscriptions_client_uid").on(table.clientId),
    emailUnique: uniqueIndex("email_subscriptions_email_uid").on(table.email),
    tokenUnique: uniqueIndex("email_subscriptions_token_uid").on(
      table.unsubscribeToken,
    ),
  }),
);

/** Topics included in an email subscription (subset of user topics). */
export const emailSubscriptionTopics = sqliteTable(
  "email_subscription_topics",
  {
    id: text("id").primaryKey(),
    subscriptionId: text("subscription_id")
      .notNull()
      .references(() => emailSubscriptions.id),
    topic: text("topic").notNull(),
    normalizedTopic: text("normalized_topic").notNull(),
  },
  (table) => ({
    subTopicUnique: uniqueIndex("email_sub_topics_uid").on(
      table.subscriptionId,
      table.normalizedTopic,
    ),
  }),
);

/**
 * Per subscription+briefing delivery log.
 * Unique index prevents duplicate sends of the same briefing.
 */
export const emailDeliveries = sqliteTable(
  "email_deliveries",
  {
    id: text("id").primaryKey(),
    subscriptionId: text("subscription_id")
      .notNull()
      .references(() => emailSubscriptions.id),
    briefingId: text("briefing_id")
      .notNull()
      .references(() => storedDailyBriefings.id),
    topic: text("topic").notNull(),
    date: text("date").notNull(),
    status: text("status").notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastAttemptAt: text("last_attempt_at"),
    provider: text("provider"),
    providerMessageId: text("provider_message_id"),
    error: text("error"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    sentAt: text("sent_at"),
  },
  (table) => ({
    subBriefingUnique: uniqueIndex("email_deliveries_sub_briefing_uid").on(
      table.subscriptionId,
      table.briefingId,
    ),
  }),
);

/**
 * Append-only pipeline analytics events (admin/dev).
 * No API keys, emails, or client identifiers.
 */
export const pipelineAnalyticsEvents = sqliteTable("pipeline_analytics_events", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  createdAt: text("created_at").notNull(),
  topic: text("topic"),
  provider: text("provider"),
  code: text("code"),
  /** Safe operational detail only — never secrets or PII. */
  detail: text("detail"),
  metaJson: text("meta_json").notNull().default("{}"),
});
