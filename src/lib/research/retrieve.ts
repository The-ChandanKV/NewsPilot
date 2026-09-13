import { getEnv } from "@/config/env";
import { listSavedStories } from "@/lib/history/store";
import { listStoredDailyBriefings } from "@/lib/jobs/daily-briefing-store";
import type { StoredDailyBriefing } from "@/lib/jobs/types";
import { loadTopicSnapshot } from "@/lib/pipeline/topic-history";
import type { PriorStorySnapshot } from "@/lib/pipeline/change-detection";
import type { ResearchRetrievedStory } from "@/lib/research/types";
import { listUserTopics } from "@/lib/topics/store";
import { normalizeTopic, tokenizeTopic } from "@/lib/utils/text";
import type { DailyBriefingStory } from "@/types/briefing";

const STOPWORDS = new Set([
  "what",
  "whats",
  "when",
  "where",
  "which",
  "who",
  "whom",
  "whose",
  "why",
  "how",
  "has",
  "have",
  "had",
  "this",
  "that",
  "these",
  "those",
  "with",
  "from",
  "into",
  "about",
  "after",
  "before",
  "since",
  "into",
  "over",
  "under",
  "again",
  "further",
  "then",
  "once",
  "here",
  "there",
  "all",
  "any",
  "both",
  "each",
  "few",
  "more",
  "most",
  "other",
  "some",
  "such",
  "only",
  "own",
  "same",
  "than",
  "too",
  "very",
  "can",
  "will",
  "just",
  "don",
  "should",
  "now",
  "the",
  "and",
  "for",
  "are",
  "was",
  "were",
  "been",
  "being",
  "show",
  "tell",
  "give",
  "make",
  "does",
  "did",
  "doing",
  "happened",
  "happen",
  "story",
  "stories",
  "news",
  "today",
  "yesterday",
  "major",
  "different",
  "covering",
  "compare",
  "reported",
  "report",
  "event",
  "important",
  "importance",
  "involved",
  "company",
  "companies",
  "source",
  "sources",
  "changed",
  "change",
  "changes",
]);

function researchTokens(question: string): string[] {
  return tokenizeTopic(question).filter((token) => !STOPWORDS.has(token));
}

function researchRelevanceScore(question: string, text: string): number {
  const tokens = researchTokens(question);
  if (tokens.length === 0) {
    // Question was only stopwords / interrogatives — fall back lightly to raw tokens.
    const fallback = tokenizeTopic(question);
    if (fallback.length === 0) return 0;
    const haystack = text.toLowerCase();
    let hits = 0;
    for (const token of fallback) {
      if (haystack.includes(token)) hits += 1;
    }
    return hits / fallback.length;
  }

  const haystack = text.toLowerCase();
  let hits = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) hits += 1;
  }
  let score = hits / tokens.length;

  // Phrase boost for consecutive content tokens present as a span.
  if (tokens.length >= 2) {
    const phrase = tokens.slice(0, Math.min(3, tokens.length)).join(" ");
    if (haystack.includes(phrase)) score = Math.min(1, score + 0.25);
  }

  // Require at least one content-token hit for a non-zero score.
  if (hits === 0) return 0;
  return score;
}

function uniqueUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of urls) {
    const trimmed = url.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function storyTextBlob(parts: {
  headline: string;
  summary?: string;
  whyItMatters?: string;
  keyFacts?: string[];
  entities?: string[];
  coveredBy?: string;
  primarySource?: string;
  topic?: string;
}): string {
  return [
    parts.topic,
    parts.headline,
    parts.summary,
    parts.whyItMatters,
    ...(parts.keyFacts ?? []),
    ...(parts.entities ?? []),
    parts.coveredBy,
    parts.primarySource,
  ]
    .filter(Boolean)
    .join(" ");
}

function scoreQuestionAgainstText(question: string, text: string): number {
  let score = researchRelevanceScore(question, text);
  const tokens = researchTokens(question);
  const haystack = text.toLowerCase();
  const normalizedQ = normalizeTopic(question);
  if (normalizedQ.length > 8 && haystack.includes(normalizedQ)) {
    score = Math.min(1, score + 0.35);
  }
  // Named-entity style tokens (capitalized in original) already lowercased in tokens.
  for (const token of tokens) {
    if (token.length >= 4 && haystack.includes(token)) {
      // Prefer distinctive matches slightly.
      score = Math.min(1, score + 0.05);
      break;
    }
  }
  return score;
}

function fromBriefingStory(
  story: DailyBriefingStory,
  meta: {
    topic: string;
    briefingDate: string | null;
    origin: ResearchRetrievedStory["origin"];
    score: number;
  },
): Omit<ResearchRetrievedStory, "citationId"> {
  const related = story.relatedSources ?? [];
  const urls = uniqueUrls([
    ...(story.articleUrls ?? []),
    ...related.map((item) => item.url),
  ]);

  return {
    storyId: story.id,
    topic: meta.topic,
    briefingDate: meta.briefingDate,
    headline: story.headline,
    summary: story.summary,
    whyItMatters: story.whyItMatters,
    keyFacts: story.keyFacts ?? [],
    entities: story.entities ?? [],
    primarySource: story.primarySource,
    coveredBy: story.coveredBy,
    articleUrls: urls,
    relatedSources: related,
    publishedAt: story.publishedAt,
    changeStatus: story.change?.status,
    changeSummary: story.change?.changeSummary ?? null,
    sourceDisagreements: (story.sourceDisagreements ?? []).map((item) => ({
      claim: item.issue,
      sources: item.positions.map((p) => p.source),
      detail: item.positions.map((p) => `${p.source}: ${p.claim}`).join(" | "),
    })),
    relevanceScore: meta.score,
    origin: meta.origin,
  };
}

function fromSnapshotStory(
  story: PriorStorySnapshot,
  topic: string,
  score: number,
): Omit<ResearchRetrievedStory, "citationId"> {
  return {
    storyId: story.clusterId || story.stableId,
    topic,
    briefingDate: null,
    headline: story.headline,
    summary: story.summary,
    whyItMatters: story.whyItMatters,
    keyFacts: story.keyFacts ?? [],
    entities: story.entities ?? [],
    primarySource: story.primarySource,
    coveredBy: story.sources.join(" · "),
    articleUrls: uniqueUrls(story.articleUrls ?? []),
    relatedSources: [],
    publishedAt: story.publishedAt,
    changeStatus: undefined,
    changeSummary: null,
    sourceDisagreements: (story.sourceDisagreements ?? []).map((item) => ({
      claim: item.issue,
      sources: item.positions.map((p) => p.source),
      detail: item.positions.map((p) => `${p.source}: ${p.claim}`).join(" | "),
    })),
    relevanceScore: score,
    origin: "topic_snapshot",
  };
}

function wantsChangeContext(question: string): boolean {
  return /\b(chang(e|ed|ing)|since yesterday|what.?s new|updated|evolved|differ|compare|disagre)\b/i.test(
    question,
  );
}

function wantsSources(question: string): boolean {
  return /\b(source|sources|outlet|outlets|reported|coverage|covering|compare)\b/i.test(
    question,
  );
}

/**
 * Lightweight keyword RAG retrieval over stored briefings / snapshots / saved stories.
 * Never returns the entire database — only top-N relevant hits.
 */
export function retrieveRelevantStories(options: {
  question: string;
  clientId?: string;
  focusStoryIds?: string[];
}): {
  stories: ResearchRetrievedStory[];
  scannedBriefings: number;
} {
  const env = getEnv();
  const question = options.question.trim();
  const maxStories = env.RESEARCH_MAX_CONTEXT_STORIES;
  const minRelevance = env.RESEARCH_MIN_RELEVANCE;
  const scanLimit = env.RESEARCH_BRIEFING_SCAN_LIMIT;

  const contentTokens = researchTokens(question);
  const requireContentMatch = contentTokens.length > 0;

  const candidates: Array<Omit<ResearchRetrievedStory, "citationId">> = [];
  const seen = new Set<string>();

  function pushCandidate(item: Omit<ResearchRetrievedStory, "citationId">) {
    const key = `${normalizeTopic(item.topic)}:${item.storyId}:${item.articleUrls[0] ?? item.headline}`;
    if (seen.has(key)) {
      const existing = candidates.find(
        (c) =>
          `${normalizeTopic(c.topic)}:${c.storyId}:${c.articleUrls[0] ?? c.headline}` ===
          key,
      );
      if (existing && item.relevanceScore > existing.relevanceScore) {
        existing.relevanceScore = item.relevanceScore;
        if (item.origin === "focus") existing.origin = "focus";
      }
      return;
    }
    seen.add(key);
    candidates.push(item);
  }

  const briefings = listStoredDailyBriefings({ limit: scanLimit });
  for (const briefing of briefings) {
    for (const story of briefing.stories) {
      const blob = storyTextBlob({
        topic: briefing.topic,
        headline: story.headline,
        summary: story.summary,
        whyItMatters: story.whyItMatters,
        keyFacts: story.keyFacts,
        entities: story.entities,
        coveredBy: story.coveredBy,
        primarySource: story.primarySource,
      });
      let score = scoreQuestionAgainstText(question, blob);
      const focused = options.focusStoryIds?.includes(story.id);
      if (focused) {
        score = Math.max(score, 0.85);
      } else if (!requireContentMatch) {
        // Pure follow-up phrasing ("why is this important?") needs focus ids.
        continue;
      } else if (score <= 0) {
        continue;
      }
      // Slight boost for today's briefing date when question mentions today.
      if (
        score > 0 &&
        /\btoday\b/i.test(question) &&
        briefing.date === new Date().toISOString().slice(0, 10)
      ) {
        score = Math.min(1, score + 0.1);
      }
      if (score >= minRelevance || focused) {
        pushCandidate(
          fromBriefingStory(story, {
            topic: briefing.topic,
            briefingDate: briefing.date,
            origin: focused ? "focus" : "stored_briefing",
            score,
          }),
        );
      }
    }
  }

  // Change / compare questions: pull prior topic snapshots for matching topics.
  if (
    requireContentMatch &&
    (wantsChangeContext(question) || wantsSources(question))
  ) {
    const topicHints = new Set<string>();
    for (const briefing of briefings) {
      const topicScore = researchRelevanceScore(question, briefing.topic);
      if (
        topicScore > 0 ||
        researchTokens(question).some((t) =>
          normalizeTopic(briefing.topic).includes(t),
        )
      ) {
        topicHints.add(briefing.topic);
      }
    }
    if (options.clientId) {
      for (const topic of listUserTopics(options.clientId)) {
        topicHints.add(topic.topic);
      }
    }
    for (const topic of topicHints) {
      const snapshot = loadTopicSnapshot(topic);
      if (!snapshot) continue;
      for (const story of snapshot.stories) {
        const blob = storyTextBlob({
          topic,
          headline: story.headline,
          summary: story.summary,
          whyItMatters: story.whyItMatters,
          keyFacts: story.keyFacts,
          entities: story.entities,
          coveredBy: story.sources.join(" "),
          primarySource: story.primarySource,
        });
        const score = scoreQuestionAgainstText(question, blob);
        if (score >= minRelevance) {
          pushCandidate(fromSnapshotStory(story, topic, score));
        }
      }
    }
  }

  if (options.clientId) {
    for (const saved of listSavedStories(options.clientId)) {
      const blob = storyTextBlob({
        topic: saved.topic,
        headline: saved.headline,
        summary: saved.summary,
        primarySource: saved.source,
      });
      let score = scoreQuestionAgainstText(question, blob);
      const focused = options.focusStoryIds?.includes(saved.storyRefId);
      if (focused) {
        score = Math.max(score, 0.85);
      } else if (!requireContentMatch) {
        continue;
      }
      if (score >= minRelevance || focused) {
        pushCandidate({
          storyId: saved.storyRefId,
          topic: saved.topic,
          briefingDate: null,
          headline: saved.headline,
          summary: saved.summary,
          whyItMatters: "",
          keyFacts: [],
          entities: [],
          primarySource: saved.source,
          coveredBy: saved.source,
          articleUrls: [saved.url],
          relatedSources: [],
          publishedAt: null,
          changeStatus: undefined,
          changeSummary: null,
          sourceDisagreements: [],
          relevanceScore: score,
          origin: focused ? "focus" : "saved_story",
        });
      }
    }
  }

  candidates.sort((a, b) => b.relevanceScore - a.relevanceScore);
  const top = candidates.slice(0, maxStories).map((item, index) => ({
    ...item,
    citationId: `S${index + 1}`,
  }));

  return {
    stories: top,
    scannedBriefings: briefings.length,
  };
}

/** Test helper: score a single briefing's stories. */
export function scoreStoriesInBriefing(
  question: string,
  briefing: StoredDailyBriefing,
): Array<{ storyId: string; score: number }> {
  return briefing.stories.map((story) => ({
    storyId: story.id,
    score: scoreQuestionAgainstText(
      question,
      storyTextBlob({
        topic: briefing.topic,
        headline: story.headline,
        summary: story.summary,
        whyItMatters: story.whyItMatters,
        keyFacts: story.keyFacts,
        entities: story.entities,
        coveredBy: story.coveredBy,
        primarySource: story.primarySource,
      }),
    ),
  }));
}
