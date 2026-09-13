export type ResearchCitation = {
  id: string;
  label: string;
  title: string;
  url: string;
  source: string;
  topic?: string;
};

export type ResearchRetrievedStory = {
  /** Stable citation id used in the model context (e.g. S1). */
  citationId: string;
  storyId: string;
  topic: string;
  briefingDate: string | null;
  headline: string;
  summary: string;
  whyItMatters: string;
  keyFacts: string[];
  entities: string[];
  primarySource: string;
  coveredBy: string;
  articleUrls: string[];
  relatedSources: Array<{ name: string; title: string; url: string }>;
  publishedAt: string | null;
  changeStatus?: string;
  changeSummary?: string | null;
  sourceDisagreements: Array<{
    claim: string;
    sources: string[];
    detail?: string;
  }>;
  relevanceScore: number;
  origin: "stored_briefing" | "topic_snapshot" | "saved_story" | "focus";
};

export type ResearchAnswer = {
  question: string;
  answer: string;
  insufficient: boolean;
  citations: ResearchCitation[];
  retrievedStoryIds: string[];
  provider: string | null;
  model: string | null;
  retrievalCount: number;
  scannedBriefings: number;
};

export type ResearchChatOptions = {
  question: string;
  clientId?: string;
  /** Prefer these story ids from a prior turn (follow-ups). */
  focusStoryIds?: string[];
  /** Optional prior Q/A for short conversational continuity (not used as facts). */
  priorExchange?: { question: string; answer: string };
};
