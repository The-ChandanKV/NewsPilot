import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { topicSnapshots } from "@/lib/db/schema";
import { MemoryCache, topicHistoryCache } from "@/lib/cache/memory";
import { getEnv } from "@/config/env";
import type {
  DailyBriefing,
  DailyBriefingStory,
  StorySummary,
} from "@/types/briefing";
import type {
  PriorStorySnapshot,
  TopicBriefingSnapshot,
} from "@/lib/pipeline/change-detection";
import { normalizeTopic } from "@/lib/utils/text";

function historyKey(topic: string): string {
  return `topic-history:${normalizeTopic(topic)}`;
}

export function getTopicHistoryTtlSeconds(): number {
  return getEnv().TOPIC_HISTORY_TTL_SECONDS;
}

function loadDurableSnapshot(topic: string): TopicBriefingSnapshot | null {
  const row = getDb()
    .select()
    .from(topicSnapshots)
    .where(eq(topicSnapshots.normalizedTopic, normalizeTopic(topic)))
    .get();
  if (!row) return null;
  try {
    return JSON.parse(row.payloadJson) as TopicBriefingSnapshot;
  } catch {
    return null;
  }
}

function saveDurableSnapshot(snapshot: TopicBriefingSnapshot): void {
  const now = new Date().toISOString();
  const normalized = normalizeTopic(snapshot.topic);
  const payloadJson = JSON.stringify(snapshot);
  const db = getDb();
  const existing = db
    .select()
    .from(topicSnapshots)
    .where(eq(topicSnapshots.normalizedTopic, normalized))
    .get();

  if (existing) {
    db.update(topicSnapshots)
      .set({
        topic: snapshot.topic,
        generatedAt: snapshot.generatedAt,
        payloadJson,
        updatedAt: now,
      })
      .where(eq(topicSnapshots.normalizedTopic, normalized))
      .run();
    return;
  }

  db.insert(topicSnapshots)
    .values({
      normalizedTopic: normalized,
      topic: snapshot.topic,
      generatedAt: snapshot.generatedAt,
      payloadJson,
      updatedAt: now,
    })
    .run();
}

export function loadTopicSnapshot(
  topic: string,
  cache: MemoryCache = topicHistoryCache,
): TopicBriefingSnapshot | null {
  const cached = cache.get<TopicBriefingSnapshot>(historyKey(topic));
  if (cached) return cached;
  const durable = loadDurableSnapshot(topic);
  if (durable) {
    cache.set(historyKey(topic), durable, getTopicHistoryTtlSeconds());
  }
  return durable;
}

export function saveTopicSnapshot(
  snapshot: TopicBriefingSnapshot,
  cache: MemoryCache = topicHistoryCache,
  ttlSeconds = getTopicHistoryTtlSeconds(),
): void {
  cache.set(historyKey(snapshot.topic), snapshot, ttlSeconds);
  try {
    saveDurableSnapshot(snapshot);
  } catch {
    // Memory cache still holds the snapshot for this process.
  }
}

/**
 * Persist the latest briefing as the baseline for the next "what changed" pass.
 * Call AFTER building the current briefing so the next run compares against it.
 */
export function saveBriefingAsTopicSnapshot(
  briefing: DailyBriefing,
  summariesByStoryId: Map<string, StorySummary>,
  cache: MemoryCache = topicHistoryCache,
): TopicBriefingSnapshot {
  const stories: PriorStorySnapshot[] = briefing.stories.map((story) => {
    const ai = summariesByStoryId.get(story.id);
    return storyToPriorSnapshot(story, ai);
  });

  const snapshot: TopicBriefingSnapshot = {
    topic: briefing.topic,
    generatedAt: briefing.generatedAt,
    stories,
  };

  saveTopicSnapshot(snapshot, cache);
  return snapshot;
}

export function storyToPriorSnapshot(
  story: DailyBriefingStory,
  ai?: StorySummary,
): PriorStorySnapshot {
  return {
    stableId: story.change.stableId,
    clusterId: story.id,
    firstSeenAt: story.change.firstSeenAt,
    lastUpdatedAt: story.change.lastUpdatedAt,
    contentHash: ai?.contentHash ?? story.change.currentState.contentHash ?? "",
    headline: story.headline,
    summary: story.summary,
    whyItMatters: story.whyItMatters,
    keyFacts: story.keyFacts,
    entities: story.entities,
    confidence: story.confidence,
    uncertaintyNotes: story.uncertaintyNotes,
    sourceDisagreements: story.sourceDisagreements,
    isAiGenerated: story.isAiGenerated,
    sources: story.coveredBy
      ? story.coveredBy.split("·").map((part) => part.trim()).filter(Boolean)
      : story.change.currentState.sources,
    articleUrls: story.articleUrls,
    publishedAt: story.publishedAt,
    primarySource: story.primarySource,
    provider: ai?.provider ?? "gemini",
    model: ai?.model,
  };
}
