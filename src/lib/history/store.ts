import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { getDb } from "@/lib/db/client";
import {
  recentlyViewedStories,
  savedStories,
  searchHistory,
} from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import { normalizeTopic } from "@/lib/utils/text";
import type {
  HistoryLibrary,
  RecentlyViewedStory,
  SavedStory,
  SaveStoryInput,
  SearchHistoryEntry,
  ViewStoryInput,
} from "@/lib/history/types";

const RECENT_SEARCH_LIMIT = 8;
const SEARCH_HISTORY_LIMIT = 50;
const RECENTLY_VIEWED_LIMIT = 20;
const SAVED_STORIES_LIMIT = 100;

function nowIso(): string {
  return new Date().toISOString();
}

function mapSearch(row: typeof searchHistory.$inferSelect): SearchHistoryEntry {
  return {
    id: row.id,
    clientId: row.clientId,
    topic: row.topic,
    normalizedTopic: row.normalizedTopic,
    storyCount: row.storyCount,
    lastBriefingAt: row.lastBriefingAt,
    searchedAt: row.searchedAt,
  };
}

function mapSaved(row: typeof savedStories.$inferSelect): SavedStory {
  return {
    id: row.id,
    clientId: row.clientId,
    storyRefId: row.storyRefId,
    headline: row.headline,
    summary: row.summary,
    source: row.source,
    url: row.url,
    topic: row.topic,
    savedAt: row.savedAt,
  };
}

function mapViewed(
  row: typeof recentlyViewedStories.$inferSelect,
): RecentlyViewedStory {
  return {
    id: row.id,
    clientId: row.clientId,
    storyRefId: row.storyRefId,
    headline: row.headline,
    source: row.source,
    url: row.url,
    topic: row.topic,
    viewedAt: row.viewedAt,
  };
}

export function listSearchHistory(
  clientId: string,
  limit = SEARCH_HISTORY_LIMIT,
): SearchHistoryEntry[] {
  return getDb()
    .select()
    .from(searchHistory)
    .where(eq(searchHistory.clientId, clientId))
    .orderBy(desc(searchHistory.searchedAt))
    .limit(limit)
    .all()
    .map(mapSearch);
}

export function listRecentSearches(clientId: string): SearchHistoryEntry[] {
  return listSearchHistory(clientId, RECENT_SEARCH_LIMIT);
}

/**
 * Upsert a topic search so revisits bump recency without duplicate rows.
 */
export function recordSearch(
  clientId: string,
  topicInput: string,
  options?: { storyCount?: number; briefingAt?: string },
): SearchHistoryEntry {
  const topic = topicInput.trim();
  if (!topic) {
    throw new AppError("Topic is required", {
      statusCode: 400,
      code: "INVALID_TOPIC",
    });
  }

  const normalized = normalizeTopic(topic);
  const db = getDb();
  const existing = db
    .select()
    .from(searchHistory)
    .where(
      and(
        eq(searchHistory.clientId, clientId),
        eq(searchHistory.normalizedTopic, normalized),
      ),
    )
    .get();

  const searchedAt = nowIso();
  const storyCount = options?.storyCount ?? existing?.storyCount ?? 0;
  const lastBriefingAt =
    options?.briefingAt ?? existing?.lastBriefingAt ?? null;

  if (existing) {
    db.update(searchHistory)
      .set({
        topic,
        storyCount,
        lastBriefingAt,
        searchedAt,
      })
      .where(eq(searchHistory.id, existing.id))
      .run();
    return mapSearch({
      ...existing,
      topic,
      storyCount,
      lastBriefingAt,
      searchedAt,
    });
  }

  const row = {
    id: randomUUID(),
    clientId,
    topic,
    normalizedTopic: normalized,
    storyCount,
    lastBriefingAt,
    searchedAt,
  };
  db.insert(searchHistory).values(row).run();
  return mapSearch(row);
}

export function clearSearchHistory(clientId: string): number {
  const result = getDb()
    .delete(searchHistory)
    .where(eq(searchHistory.clientId, clientId))
    .run();
  return result.changes;
}

export function listSavedStories(clientId: string): SavedStory[] {
  return getDb()
    .select()
    .from(savedStories)
    .where(eq(savedStories.clientId, clientId))
    .orderBy(desc(savedStories.savedAt))
    .limit(SAVED_STORIES_LIMIT)
    .all()
    .map(mapSaved);
}

export function getSavedStoryByRef(
  clientId: string,
  storyRefId: string,
): SavedStory | null {
  const row = getDb()
    .select()
    .from(savedStories)
    .where(
      and(
        eq(savedStories.clientId, clientId),
        eq(savedStories.storyRefId, storyRefId),
      ),
    )
    .get();
  return row ? mapSaved(row) : null;
}

export function saveStory(clientId: string, input: SaveStoryInput): SavedStory {
  const storyRefId = input.storyRefId.trim();
  const headline = input.headline.trim();
  const summary = input.summary.trim();
  const source = input.source.trim();
  const url = input.url.trim();
  const topic = input.topic.trim();

  if (!storyRefId || !headline || !url || !topic) {
    throw new AppError("storyRefId, headline, url, and topic are required", {
      statusCode: 400,
      code: "INVALID_SAVED_STORY",
    });
  }

  const existing = getSavedStoryByRef(clientId, storyRefId);
  if (existing) {
    return existing;
  }

  const row = {
    id: randomUUID(),
    clientId,
    storyRefId,
    headline,
    summary: summary || headline,
    source: source || "Unknown",
    url,
    topic,
    savedAt: nowIso(),
  };
  getDb().insert(savedStories).values(row).run();
  return mapSaved(row);
}

export function unsaveStory(clientId: string, savedId: string): void {
  const result = getDb()
    .delete(savedStories)
    .where(and(eq(savedStories.id, savedId), eq(savedStories.clientId, clientId)))
    .run();
  if (result.changes === 0) {
    throw new AppError("Saved story not found", {
      statusCode: 404,
      code: "SAVED_STORY_NOT_FOUND",
    });
  }
}

export function unsaveStoryByRef(clientId: string, storyRefId: string): boolean {
  const result = getDb()
    .delete(savedStories)
    .where(
      and(
        eq(savedStories.clientId, clientId),
        eq(savedStories.storyRefId, storyRefId),
      ),
    )
    .run();
  return result.changes > 0;
}

export function listRecentlyViewed(clientId: string): RecentlyViewedStory[] {
  return getDb()
    .select()
    .from(recentlyViewedStories)
    .where(eq(recentlyViewedStories.clientId, clientId))
    .orderBy(desc(recentlyViewedStories.viewedAt))
    .limit(RECENTLY_VIEWED_LIMIT)
    .all()
    .map(mapViewed);
}

export function recordStoryView(
  clientId: string,
  input: ViewStoryInput,
): RecentlyViewedStory {
  const storyRefId = input.storyRefId.trim();
  const headline = input.headline.trim();
  const source = input.source.trim() || "Unknown";
  const url = input.url.trim();
  const topic = input.topic.trim();

  if (!storyRefId || !headline || !url || !topic) {
    throw new AppError("storyRefId, headline, url, and topic are required", {
      statusCode: 400,
      code: "INVALID_VIEWED_STORY",
    });
  }

  const db = getDb();
  const existing = db
    .select()
    .from(recentlyViewedStories)
    .where(
      and(
        eq(recentlyViewedStories.clientId, clientId),
        eq(recentlyViewedStories.storyRefId, storyRefId),
      ),
    )
    .get();

  const viewedAt = nowIso();
  if (existing) {
    db.update(recentlyViewedStories)
      .set({ headline, source, url, topic, viewedAt })
      .where(eq(recentlyViewedStories.id, existing.id))
      .run();
    return mapViewed({ ...existing, headline, source, url, topic, viewedAt });
  }

  const row = {
    id: randomUUID(),
    clientId,
    storyRefId,
    headline,
    source,
    url,
    topic,
    viewedAt,
  };
  db.insert(recentlyViewedStories).values(row).run();

  // Cap retention — drop oldest beyond the limit.
  const all = db
    .select()
    .from(recentlyViewedStories)
    .where(eq(recentlyViewedStories.clientId, clientId))
    .orderBy(desc(recentlyViewedStories.viewedAt))
    .all();
  if (all.length > RECENTLY_VIEWED_LIMIT) {
    for (const extra of all.slice(RECENTLY_VIEWED_LIMIT)) {
      db.delete(recentlyViewedStories)
        .where(eq(recentlyViewedStories.id, extra.id))
        .run();
    }
  }

  return mapViewed(row);
}

export function clearRecentlyViewed(clientId: string): number {
  const result = getDb()
    .delete(recentlyViewedStories)
    .where(eq(recentlyViewedStories.clientId, clientId))
    .run();
  return result.changes;
}

export function clearHistory(clientId: string): {
  searchesCleared: number;
  viewedCleared: number;
} {
  return {
    searchesCleared: clearSearchHistory(clientId),
    viewedCleared: clearRecentlyViewed(clientId),
  };
}

export function getHistoryLibrary(clientId: string): HistoryLibrary {
  return {
    recentSearches: listRecentSearches(clientId),
    searchHistory: listSearchHistory(clientId),
    savedStories: listSavedStories(clientId),
    recentlyViewed: listRecentlyViewed(clientId),
  };
}

export function listSavedStoryRefIds(clientId: string): string[] {
  return listSavedStories(clientId).map((story) => story.storyRefId);
}
