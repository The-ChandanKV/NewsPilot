export type PipelineAnalyticsEventKind =
  | "news_provider_failure"
  | "ai_request_failure"
  | "ai_request_retry";

export type PipelineAnalyticsEvent = {
  id: string;
  kind: PipelineAnalyticsEventKind;
  createdAt: string;
  topic: string | null;
  provider: string | null;
  code: string | null;
  detail: string | null;
  meta: Record<string, unknown>;
};

export type PipelineAnalyticsDayTrend = {
  date: string;
  articlesRetrieved: number;
  duplicateArticlesRemoved: number;
  duplicateRate: number;
  storiesGenerated: number;
  aiCalls: number;
  aiCacheHits: number;
  aiCacheHitRate: number;
  averageBriefingGenerationMs: number;
  averageSourcesPerStory: number;
  apiFailures: number;
  failedAiRequests: number;
  briefingCount: number;
};

export type PipelineTopicStats = {
  topic: string;
  articlesRetrieved: number;
  storiesGenerated: number;
  aiCalls: number;
  briefingCount: number;
  averageSourcesPerStory: number;
};

export type PipelineProviderFailureStat = {
  provider: string;
  kind: "news" | "ai";
  count: number;
  lastCode: string | null;
};

export type PipelineAnalyticsSnapshot = {
  generatedAt: string;
  windowDays: number;
  windowFrom: string;
  windowTo: string;
  totals: {
    articlesRetrieved: number;
    duplicateArticlesRemoved: number;
    duplicateRate: number;
    storiesGenerated: number;
    averageSourcesPerStory: number;
    aiCalls: number;
    aiCacheHits: number;
    aiCacheHitRate: number;
    failedAiRequests: number;
    averageBriefingGenerationMs: number;
    apiFailures: number;
    briefingCount: number;
    jobRunsCompleted: number;
    jobRunsFailed: number;
    jobTopicsFailed: number;
  };
  trends: PipelineAnalyticsDayTrend[];
  articlesPerTopic: PipelineTopicStats[];
  mostCoveredTopics: Array<{
    topic: string;
    storiesGenerated: number;
    briefingCount: number;
    articlesRetrieved: number;
  }>;
  failedProviders: PipelineProviderFailureStat[];
  /**
   * Structured flags for ops triage (excessive API/AI, dupes, slow, failures).
   * Computed in analytics layer — UI only renders them.
   */
  alerts: PipelineAnalyticsAlert[];
  insights: string[];
  /**
   * Live process metrics for this Node server (dev cost/perf view).
   * Resets on process restart; complements durable daily-job totals.
   */
  developmentMetrics: DevelopmentPipelineMetrics;
};

export type DevelopmentPipelineMetrics = {
  aiCalls: number;
  cacheHits: number;
  articlesProcessed: number;
  duplicateArticlesRemoved: number;
  storiesGenerated: number;
  averageProcessingTimeMs: number;
  briefingRuns: number;
  summaryCacheHits: number;
  newsCacheHits: number;
  briefingCacheHits: number;
  durableSummaryHits: number;
  durableSummariesStored: number;
  aiDedupedCalls: number;
  memoryCaches: {
    news: { hits: number; misses: number; hitRate: number; size: number };
    summary: { hits: number; misses: number; hitRate: number; size: number };
    briefing: { hits: number; misses: number; hitRate: number; size: number };
  };
  recentRuns: Array<{
    at: string;
    topic: string;
    durationMs: number;
    aiCalls: number;
    cacheHits: number;
    articlesProcessed: number;
    duplicateArticlesRemoved: number;
    storiesGenerated: number;
    fromBriefingCache: boolean;
  }>;
};

export type PipelineAnalyticsAlertKind =
  | "excessive_api_usage"
  | "excessive_ai_calls"
  | "duplicate_news"
  | "slow_processing"
  | "failed_providers";

export type PipelineAnalyticsAlertSeverity = "info" | "warning" | "critical";

export type PipelineAnalyticsAlert = {
  kind: PipelineAnalyticsAlertKind;
  severity: PipelineAnalyticsAlertSeverity;
  title: string;
  detail: string;
  metric?: string;
  value?: number;
};
