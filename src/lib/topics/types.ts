import type { DailyBriefingStory } from "@/types/briefing";

export type TopicFrequency = "daily" | "twice_daily" | "weekly";

export const TOPIC_FREQUENCIES: TopicFrequency[] = [
  "daily",
  "twice_daily",
  "weekly",
];

export function isTopicFrequency(value: string): value is TopicFrequency {
  return TOPIC_FREQUENCIES.includes(value as TopicFrequency);
}

export function frequencyLabel(frequency: TopicFrequency): string {
  if (frequency === "twice_daily") return "Twice daily";
  if (frequency === "weekly") return "Weekly";
  return "Daily";
}

export type UserTopic = {
  id: string;
  clientId: string;
  topic: string;
  normalizedTopic: string;
  sortOrder: number;
  frequency: TopicFrequency;
  createdAt: string;
  updatedAt: string;
};

export type UserTopicInput = {
  topic: string;
  frequency?: TopicFrequency;
};

export type PersonalizedFeedStory = DailyBriefingStory & {
  /** Topic this story was pulled from. */
  matchedTopic: string;
  matchedTopicId: string;
  topicPriority: number;
  frequency: TopicFrequency;
  /** Combined personalized ranking score (0–1). */
  personalScore: number;
  /** Other saved topics that also matched this story after dedupe. */
  alsoInTopics: string[];
};

export type PersonalizedFeed = {
  generatedAt: string;
  topics: UserTopic[];
  totalStories: number;
  llmCalls: number;
  summaryCacheHits: number;
  warnings: string[];
  stories: PersonalizedFeedStory[];
};
