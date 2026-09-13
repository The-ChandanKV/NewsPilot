import type {
  DailyBriefingStory,
  WhatsNewSummary,
} from "@/types/briefing";

export type DailyBriefingGenerationStats = {
  articlesRetrieved: number;
  duplicateArticlesRemoved: number;
  storyClustersCreated: number;
  aiCalls: number;
  cachedSummaries: number;
  generationDurationMs: number;
};

/**
 * Persisted automatic daily briefing for a subscribed topic.
 */
export type StoredDailyBriefing = {
  id: string;
  topic: string;
  /** Calendar date in YYYY-MM-DD (job timezone). */
  date: string;
  generatedAt: string;
  stories: DailyBriefingStory[];
  changes: WhatsNewSummary;
  generationStats: DailyBriefingGenerationStats;
  warnings: string[];
  /** Optional presentation helpers for the daily digest view. */
  topDevelopments: string[];
  whyItMatters: string[];
};

export type DailyBriefingJobTopicResult = {
  topic: string;
  status: "created" | "skipped_existing" | "failed";
  briefingId?: string;
  error?: string;
  generationStats?: DailyBriefingGenerationStats;
};

export type DailyBriefingJobResult = {
  jobKey: string;
  date: string;
  startedAt: string;
  finishedAt: string;
  status: "completed" | "skipped_duplicate_job" | "failed";
  topicsProcessed: number;
  topicsCreated: number;
  topicsSkipped: number;
  topicsFailed: number;
  results: DailyBriefingJobTopicResult[];
  error?: string;
};
