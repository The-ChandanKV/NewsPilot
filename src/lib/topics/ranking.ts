import { getScoringConfig } from "@/config/scoring";
import { urlOverlapScore } from "@/lib/pipeline/change-detection";
import { relevanceScore } from "@/lib/utils/text";
import {
  frequencyBoost,
  topicPriorityScore,
} from "@/lib/topics/store";
import type {
  PersonalizedFeedStory,
  UserTopic,
} from "@/lib/topics/types";
import type { DailyBriefingStory } from "@/types/briefing";

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function freshnessFromPublishedAt(
  publishedAt: string | null,
  now: Date,
): number {
  if (!publishedAt) return 0.15;
  const ms = Date.parse(publishedAt);
  if (Number.isNaN(ms)) return 0.15;
  const ageHours = Math.max(0, (now.getTime() - ms) / (1000 * 60 * 60));
  const halfLife = getScoringConfig().FRESHNESS_HALF_LIFE_HOURS;
  return clamp01(Math.pow(0.5, ageHours / halfLife));
}

/**
 * Personalized ranking for the combined feed.
 * Reuses existing story importance / verification signals — no new LLM calls.
 */
export function scorePersonalizedStory(args: {
  story: DailyBriefingStory;
  topic: UserTopic;
  topicCount: number;
  now?: Date;
}): number {
  const now = args.now ?? new Date();
  const topicRelevance = clamp01(
    Math.max(
      relevanceScore(args.topic.topic, args.story.headline, args.story.summary),
      args.story.importanceScore,
    ),
  );
  const freshness = freshnessFromPublishedAt(args.story.publishedAt, now);
  const importance = clamp01(args.story.importanceScore);
  const sourceDiversity = clamp01(args.story.verification?.sourceDiversity ?? 0);
  const priority = topicPriorityScore(args.topic.sortOrder, args.topicCount);
  const freq = frequencyBoost(args.topic.frequency);

  // Weighted blend requested by product: relevance, freshness, importance,
  // source diversity, and user-selected topic priority (with frequency soft boost).
  const score =
    topicRelevance * 0.28 +
    freshness * 0.22 +
    importance * 0.22 +
    sourceDiversity * 0.1 +
    priority * 0.12 * freq +
    0.06 * freq;

  return round4(clamp01(score));
}

export function toPersonalizedStory(
  story: DailyBriefingStory,
  topic: UserTopic,
  topicCount: number,
  now: Date = new Date(),
): PersonalizedFeedStory {
  return {
    ...story,
    matchedTopic: topic.topic,
    matchedTopicId: topic.id,
    topicPriority: topicPriorityScore(topic.sortOrder, topicCount),
    frequency: topic.frequency,
    personalScore: scorePersonalizedStory({ story, topic, topicCount, now }),
    alsoInTopics: [],
  };
}

/**
 * Collapse cross-topic duplicates by URL overlap; keep highest personalScore.
 */
export function dedupePersonalizedStories(
  stories: PersonalizedFeedStory[],
): PersonalizedFeedStory[] {
  const kept: PersonalizedFeedStory[] = [];

  for (const story of stories) {
    let merged = false;
    for (let i = 0; i < kept.length; i += 1) {
      const existing = kept[i];
      const overlap = urlOverlapScore(existing.articleUrls, story.articleUrls);
      const sameHeadline =
        existing.headline.trim().toLowerCase() ===
        story.headline.trim().toLowerCase();

      if (overlap >= 0.25 || (overlap > 0 && sameHeadline)) {
        const winner =
          story.personalScore > existing.personalScore ? story : existing;
        const loser =
          story.personalScore > existing.personalScore ? existing : story;
        const alsoIn = new Set([
          ...winner.alsoInTopics,
          ...loser.alsoInTopics,
          loser.matchedTopic,
        ]);
        alsoIn.delete(winner.matchedTopic);
        kept[i] = { ...winner, alsoInTopics: [...alsoIn].sort() };
        merged = true;
        break;
      }
    }
    if (!merged) {
      kept.push(story);
    }
  }

  return kept.sort((a, b) => b.personalScore - a.personalScore);
}

export function rankPersonalizedStories(
  stories: PersonalizedFeedStory[],
): PersonalizedFeedStory[] {
  return [...stories].sort((a, b) => {
    if (b.personalScore !== a.personalScore) {
      return b.personalScore - a.personalScore;
    }
    if (a.topicPriority !== b.topicPriority) {
      return b.topicPriority - a.topicPriority;
    }
    return (b.importanceScore ?? 0) - (a.importanceScore ?? 0);
  });
}
