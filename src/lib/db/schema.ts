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
