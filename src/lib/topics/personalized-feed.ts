import { getEnv } from "@/config/env";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import {
  buildBriefingForTopic,
  type BuildBriefingOptions,
} from "@/lib/pipeline/briefing";
import {
  dedupePersonalizedStories,
  rankPersonalizedStories,
  toPersonalizedStory,
} from "@/lib/topics/ranking";
import { listUserTopics } from "@/lib/topics/store";
import type { PersonalizedFeed, UserTopic } from "@/lib/topics/types";

export type BuildPersonalizedFeedOptions = {
  maxStories?: number;
  storiesPerTopic?: number;
  forceRefresh?: boolean;
  now?: Date;
  buildBriefing?: typeof buildBriefingForTopic;
  briefingOptions?: Omit<BuildBriefingOptions, "maxStories" | "forceRefresh" | "now">;
};

/**
 * Combined personalized feed across saved topics.
 * Reuses per-topic briefing/summaries — does NOT create a separate AI pass.
 */
export async function buildPersonalizedFeed(
  clientId: string,
  options: BuildPersonalizedFeedOptions = {},
): Promise<PersonalizedFeed> {
  const topics = listUserTopics(clientId);
  if (topics.length === 0) {
    throw new AppError("Add at least one topic to build a personalized feed", {
      statusCode: 400,
      code: "NO_TOPICS",
    });
  }

  const env = getEnv();
  const now = options.now ?? new Date();
  const maxStories =
    options.maxStories ?? Math.min(env.MAX_STORIES_PER_BRIEFING * 2, 30);
  const storiesPerTopic =
    options.storiesPerTopic ??
    Math.max(3, Math.ceil(maxStories / Math.max(1, topics.length)));
  const buildBriefing = options.buildBriefing ?? buildBriefingForTopic;

  const warnings: string[] = [];
  let llmCalls = 0;
  let summaryCacheHits = 0;

  const topicBriefings = await Promise.all(
    topics.map(async (topic) => {
      try {
        const briefing = await buildBriefing(topic.topic, {
          ...options.briefingOptions,
          maxStories: storiesPerTopic,
          forceRefresh: options.forceRefresh,
          now,
        });
        llmCalls += briefing.llmCalls;
        summaryCacheHits += briefing.summaryCacheHits;
        warnings.push(...briefing.warnings.map((w) => `[${topic.topic}] ${w}`));
        return { topic, briefing };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`[${topic.topic}] Failed to load briefing: ${message}`);
        logger.warn("Personalized feed topic failed", {
          topic: topic.topic,
          error: message,
        });
        return { topic, briefing: null };
      }
    }),
  );

  const candidates = topicBriefings.flatMap(({ topic, briefing }) => {
    if (!briefing) return [];
    return briefing.stories.map((story) =>
      toPersonalizedStory(story, topic, topics.length, now),
    );
  });

  const stories = rankPersonalizedStories(
    dedupePersonalizedStories(candidates),
  ).slice(0, maxStories);

  return {
    generatedAt: now.toISOString(),
    topics,
    totalStories: stories.length,
    llmCalls,
    summaryCacheHits,
    warnings,
    stories,
  };
}

export function topicsForClient(clientId: string): UserTopic[] {
  return listUserTopics(clientId);
}
