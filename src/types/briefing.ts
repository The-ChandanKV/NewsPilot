/**
 * Core domain types for NewsPilot.
 * Shared across API, providers, and (later) pipeline logic.
 */

export type AiProviderName = "claude" | "gemini";
export type NewsProviderName = "google_news_rss" | "newsapi" | "gnews";
export type ConfidenceLevel = "high" | "medium" | "low";

export interface Article {
  id: string;
  externalId?: string;
  url: string;
  canonicalUrl: string;
  title: string;
  snippet?: string;
  sourceName: string;
  author?: string;
  publishedAt?: string;
  fetchedAt: string;
  provider: NewsProviderName;
  topic?: string;
  imageUrl?: string;
  sourceTier?: 1 | 2 | 3;
}

/** Public API shape for news ingestion responses. */
export interface NewsArticleDto {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string | null;
  author: string | null;
  description: string | null;
  topic: string;
  imageUrl: string | null;
  provider: NewsProviderName;
}

/** Deterministic pipeline scores for a story cluster (0–1 each). */
export interface StoryScores {
  relevance: number;
  freshness: number;
  sourceDiversity: number;
  sourceQuality: number;
  /** Weighted combination used for ranking. */
  rank: number;
}

export type VerificationLevel =
  | "well_supported"
  | "confirmed"
  | "limited"
  | "contested";

/**
 * Explainable multi-source support indicator.
 * Estimates attribution / corroboration — never marks a story true or false.
 */
export interface StoryVerification {
  level: VerificationLevel;
  /** Short UI title, e.g. "Multiple sources". */
  label: string;
  /** Supporting line, e.g. "3 independent sources". */
  detail: string;
  icon: "check" | "warning";
  sourceCount: number;
  independentSourceCount: number;
  sourceDiversity: number;
  sourceRecency: number;
  sourceQualityScore: number;
  multipleSourcesConfirmEvent: boolean;
  firstReportedBy: string | null;
  /** Transparent human-readable signals for the UI. */
  signals: string[];
  /** Full explainable breakdown of how the indicator was derived. */
  explanation: string;
  publishers: Array<{
    id: string;
    name: string;
    tier: 1 | 2 | 3;
    tierLabel: string;
    qualityScore: number;
  }>;
}

/**
 * A clustered story/event — multiple articles covering the same news item.
 * UI should show one card with "Covered by: Reuters · The Verge · …".
 */
export interface StoryCluster {
  id: string;
  /** Representative headline for display. */
  headline: string;
  /** @deprecated Prefer `headline` — kept for compatibility. */
  primaryHeadline: string;
  /** All articles in the cluster (newest first). */
  articles: NewsArticleDto[];
  sources: string[];
  firstPublishedAt: string | null;
  latestPublishedAt: string | null;
  /** Mean pairwise similarity within the cluster (1 for singletons). */
  similarityScore: number;
  representativeArticle: NewsArticleDto;
  relatedArticles: NewsArticleDto[];
  articleCount: number;
  sourceCount: number;
  scores: StoryScores;
  /** Multi-source verification / support indicator. */
  verification: StoryVerification;
}

export interface SourceDisagreement {
  issue: string;
  positions: Array<{
    source: string;
    claim: string;
  }>;
}

/** AI-generated summary for one story cluster (one LLM call). */
export interface StorySummary {
  headline: string;
  summary: string;
  whyItMatters: string;
  keyFacts: string[];
  entities: string[];
  confidence: ConfidenceLevel;
  uncertaintyNotes: string[];
  sourceDisagreements: SourceDisagreement[];
  reportedFacts: string[];
  inferences: string[];
  contentHash: string;
  cached: boolean;
  provider: AiProviderName;
  model?: string;
  isAiGenerated: boolean;
}

export interface SummarizedStory extends StoryCluster {
  ai: StorySummary;
}

/** How a story relates to the previous briefing for the same topic. */
export type StoryChangeStatus = "new" | "updated" | "ongoing";

/** Compact story state used for change comparison. */
export interface StoryStateSnapshot {
  headline: string;
  summary: string;
  sources: string[];
  articleUrls: string[];
  publishedAt: string | null;
  contentHash?: string;
}

/**
 * Explainable change tracking for a story across briefings.
 * Classification is deterministic (URLs, sources, headlines, hashes).
 */
export interface StoryChangeInfo {
  status: StoryChangeStatus;
  /** Stable identity across briefings (survives cluster-id churn). */
  stableId: string;
  firstSeenAt: string;
  lastUpdatedAt: string;
  previousState: StoryStateSnapshot | null;
  currentState: StoryStateSnapshot;
  /** Concise human-readable delta; null when nothing material changed. */
  changeSummary: string | null;
  materialChange: boolean;
  matchedPreviousId: string | null;
}

/** Aggregated "What's new" panel for a briefing. */
export interface WhatsNewSummary {
  comparedToGeneratedAt: string | null;
  /** e.g. "What's new since yesterday" */
  label: string;
  newCount: number;
  updatedCount: number;
  ongoingCount: number;
  highlights: Array<{
    status: StoryChangeStatus;
    headline: string;
    changeSummary: string | null;
  }>;
}

/** Public daily briefing story card (API response). */
export interface DailyBriefingStory {
  id: string;
  headline: string;
  summary: string;
  whyItMatters: string;
  keyFacts: string[];
  entities: string[];
  publishedAt: string | null;
  primarySource: string;
  relatedSources: Array<{
    name: string;
    title: string;
    url: string;
  }>;
  articleUrls: string[];
  confidence: ConfidenceLevel;
  uncertaintyNotes: string[];
  sourceDisagreements: SourceDisagreement[];
  isAiGenerated: boolean;
  importanceScore: number;
  /** Covered-by line for UI, e.g. "Reuters · The Verge · TechCrunch". */
  coveredBy: string;
  verification: StoryVerification;
  /** Diff vs previous briefing for this topic. */
  change: StoryChangeInfo;
}

export interface DailyBriefing {
  topic: string;
  generatedAt: string;
  timeRange: {
    from: string;
    to: string;
    hours: number;
  };
  totalStories: number;
  cached: boolean;
  llmCalls: number;
  summaryCacheHits: number;
  providerUsed: AiProviderName;
  stories: DailyBriefingStory[];
  /** Diff vs last stored briefing for this topic. */
  whatsNew: WhatsNewSummary;
  /** Non-fatal upstream issues (partial success). */
  warnings: string[];
}

export interface StoryConflict {
  claim: string;
  sources: string[];
  note: string;
}

export interface BriefingStory {
  id?: string;
  rank: number;
  headline: string;
  summary: string;
  whyItMatters: string;
  factsReported: string[];
  conflicts: StoryConflict[];
  confidence: ConfidenceLevel;
  publishedAt?: string;
  primaryUrl: string;
  primarySource: string;
  relatedSources: Array<{
    title: string;
    url: string;
    sourceName: string;
  }>;
  /** True when summary/whyItMatters were produced by an LLM. */
  isAiGenerated: boolean;
}

export interface Briefing {
  id?: string;
  topic: string;
  generatedAt: string;
  providerUsed?: AiProviderName;
  llmCalls: number;
  stories: BriefingStory[];
}

export interface HealthStatus {
  status: "ok" | "degraded" | "error";
  app: string;
  timestamp: string;
  database: {
    connected: boolean;
    path: string;
  };
  ai: {
    selectedProvider: AiProviderName;
    configured: boolean;
  };
  news: {
    enabledProviders: NewsProviderName[];
    configuredProviders: NewsProviderName[];
  };
}
