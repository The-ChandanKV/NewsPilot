import { createHash } from "crypto";
import { canonicalizeUrl } from "@/lib/utils/url";
import type {
  DailyBriefingStory,
  StoryChangeInfo,
  StoryChangeStatus,
  StoryCluster,
  StoryStateSnapshot,
  StorySummary,
  WhatsNewSummary,
} from "@/types/briefing";

/** Minimum Jaccard overlap on article URLs to treat two stories as the same event. */
export const STORY_MATCH_URL_OVERLAP = 0.25;

export type PriorStorySnapshot = {
  stableId: string;
  clusterId: string;
  firstSeenAt: string;
  lastUpdatedAt: string;
  contentHash: string;
  headline: string;
  summary: string;
  whyItMatters: string;
  keyFacts: string[];
  entities: string[];
  confidence: StorySummary["confidence"];
  uncertaintyNotes: string[];
  sourceDisagreements: StorySummary["sourceDisagreements"];
  isAiGenerated: boolean;
  sources: string[];
  articleUrls: string[];
  publishedAt: string | null;
  primarySource: string;
  provider: StorySummary["provider"];
  model?: string;
};

export type TopicBriefingSnapshot = {
  topic: string;
  generatedAt: string;
  stories: PriorStorySnapshot[];
};

function safeCanonical(url: string): string {
  try {
    return canonicalizeUrl(url);
  } catch {
    return url.trim().toLowerCase();
  }
}

export function normalizeUrlSet(urls: string[]): string[] {
  return [...new Set(urls.map(safeCanonical).filter(Boolean))].sort();
}

export function urlOverlapScore(a: string[], b: string[]): number {
  const setA = new Set(normalizeUrlSet(a));
  const setB = new Set(normalizeUrlSet(b));
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const url of setA) {
    if (setB.has(url)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function stableStoryId(urls: string[]): string {
  const key = normalizeUrlSet(urls).join("|") || "empty";
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

function normalizeHeadline(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sourcesEqual(a: string[], b: string[]): boolean {
  const left = [...new Set(a.map((s) => s.trim().toLowerCase()).filter(Boolean))].sort();
  const right = [...new Set(b.map((s) => s.trim().toLowerCase()).filter(Boolean))].sort();
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function toState(args: {
  headline: string;
  summary: string;
  sources: string[];
  articleUrls: string[];
  publishedAt: string | null;
  contentHash?: string;
}): StoryStateSnapshot {
  return {
    headline: args.headline,
    summary: args.summary,
    sources: [...args.sources].sort((a, b) => a.localeCompare(b)),
    articleUrls: normalizeUrlSet(args.articleUrls),
    publishedAt: args.publishedAt,
    contentHash: args.contentHash,
  };
}

export type MaterialChangeFlags = {
  materialChange: boolean;
  contentHashChanged: boolean;
  urlsAdded: string[];
  urlsRemoved: string[];
  sourcesAdded: string[];
  sourcesRemoved: string[];
  headlineChanged: boolean;
  newerCoverage: boolean;
};

/**
 * Deterministic material-change check — no LLM.
 */
export function detectMaterialChange(
  current: {
    headline: string;
    sources: string[];
    articleUrls: string[];
    publishedAt: string | null;
    contentHash?: string;
  },
  previous: PriorStorySnapshot,
): MaterialChangeFlags {
  const currentUrls = normalizeUrlSet(current.articleUrls);
  const previousUrls = normalizeUrlSet(previous.articleUrls);
  const prevUrlSet = new Set(previousUrls);
  const curUrlSet = new Set(currentUrls);

  const urlsAdded = currentUrls.filter((url) => !prevUrlSet.has(url));
  const urlsRemoved = previousUrls.filter((url) => !curUrlSet.has(url));

  const curSources = [
    ...new Set(current.sources.map((s) => s.trim()).filter(Boolean)),
  ];
  const prevSources = [
    ...new Set(previous.sources.map((s) => s.trim()).filter(Boolean)),
  ];
  const prevSourceSet = new Set(prevSources.map((s) => s.toLowerCase()));
  const curSourceSet = new Set(curSources.map((s) => s.toLowerCase()));
  const sourcesAdded = curSources.filter(
    (source) => !prevSourceSet.has(source.toLowerCase()),
  );
  const sourcesRemoved = prevSources.filter(
    (source) => !curSourceSet.has(source.toLowerCase()),
  );

  const headlineChanged =
    normalizeHeadline(current.headline) !== normalizeHeadline(previous.headline);

  const contentHashChanged = Boolean(
    current.contentHash &&
      previous.contentHash &&
      current.contentHash !== previous.contentHash,
  );

  let newerCoverage = false;
  if (current.publishedAt && previous.publishedAt) {
    const curMs = Date.parse(current.publishedAt);
    const prevMs = Date.parse(previous.publishedAt);
    if (!Number.isNaN(curMs) && !Number.isNaN(prevMs) && curMs > prevMs) {
      newerCoverage = true;
    }
  }

  const coverageChanged =
    urlsAdded.length > 0 ||
    sourcesAdded.length > 0 ||
    !sourcesEqual(curSources, prevSources);

  const hashesPresent = Boolean(current.contentHash && previous.contentHash);
  // Prefer content-hash equality over headline text: AI headlines often differ
  // from cluster/representative headlines even when underlying articles match.
  const materialChange = hashesPresent
    ? contentHashChanged || coverageChanged
    : contentHashChanged ||
      headlineChanged ||
      coverageChanged ||
      (newerCoverage && urlsAdded.length > 0);

  return {
    materialChange,
    contentHashChanged,
    urlsAdded,
    urlsRemoved,
    sourcesAdded,
    sourcesRemoved,
    headlineChanged,
    newerCoverage,
  };
}

/**
 * Concise deterministic change summary (no LLM).
 */
export function buildDeterministicChangeSummary(
  flags: MaterialChangeFlags,
  currentHeadline: string,
  previousHeadline: string,
): string {
  const parts: string[] = [];

  if (flags.headlineChanged) {
    parts.push(`Headline evolved: "${previousHeadline}" → "${currentHeadline}"`);
  }
  if (flags.sourcesAdded.length > 0) {
    parts.push(`New source coverage: ${flags.sourcesAdded.join(", ")}`);
  }
  if (flags.sourcesRemoved.length > 0) {
    parts.push(`No longer covered by: ${flags.sourcesRemoved.join(", ")}`);
  }
  if (flags.urlsAdded.length > 0) {
    parts.push(
      `${flags.urlsAdded.length} new article${flags.urlsAdded.length === 1 ? "" : "s"} added`,
    );
  }
  if (flags.newerCoverage && !flags.headlineChanged && flags.urlsAdded.length === 0) {
    parts.push("Newer reporting timestamps since last briefing");
  }
  if (flags.contentHashChanged && parts.length === 0) {
    parts.push("Story content changed since last briefing");
  }

  return parts.join(". ") || "Story updated since last briefing";
}

/**
 * Match a current cluster to the best prior snapshot by URL overlap.
 */
export function matchPriorStory(
  articleUrls: string[],
  priors: PriorStorySnapshot[],
  usedIds: Set<string>,
  minOverlap = STORY_MATCH_URL_OVERLAP,
): PriorStorySnapshot | null {
  let best: PriorStorySnapshot | null = null;
  let bestScore = 0;

  for (const prior of priors) {
    if (usedIds.has(prior.stableId)) continue;
    const score = urlOverlapScore(articleUrls, prior.articleUrls);
    if (score > bestScore) {
      bestScore = score;
      best = prior;
    }
  }

  if (!best || bestScore < minOverlap) {
    if (best) {
      const current = normalizeUrlSet(articleUrls);
      const priorUrls = normalizeUrlSet(best.articleUrls);
      const shared = current.filter((url) => priorUrls.includes(url));
      const smaller = Math.min(current.length, priorUrls.length);
      if (shared.length >= 1 && smaller > 0 && shared.length / smaller >= 0.5) {
        return best;
      }
    }
    return null;
  }

  return best;
}

export function clusterArticleUrls(cluster: StoryCluster): string[] {
  const articles = cluster.articles.length
    ? cluster.articles
    : [cluster.representativeArticle, ...cluster.relatedArticles];
  return articles.map((article) => article.url);
}

export function assessClusterChange(args: {
  cluster: StoryCluster;
  contentHash: string;
  prior: PriorStorySnapshot | null;
  nowIso: string;
}): StoryChangeInfo {
  const urls = clusterArticleUrls(args.cluster);
  const headline = args.cluster.headline || args.cluster.primaryHeadline;
  const sources = args.cluster.sources;
  const publishedAt = args.cluster.latestPublishedAt;

  const currentState = toState({
    headline,
    summary: "",
    sources,
    articleUrls: urls,
    publishedAt,
    contentHash: args.contentHash,
  });

  if (!args.prior) {
    return {
      status: "new",
      stableId: stableStoryId(urls),
      firstSeenAt: args.nowIso,
      lastUpdatedAt: args.nowIso,
      previousState: null,
      currentState,
      changeSummary: "First seen in this briefing",
      materialChange: true,
      matchedPreviousId: null,
    };
  }

  const flags = detectMaterialChange(
    {
      headline,
      sources,
      articleUrls: urls,
      publishedAt,
      contentHash: args.contentHash,
    },
    args.prior,
  );

  const previousState = toState({
    headline: args.prior.headline,
    summary: args.prior.summary,
    sources: args.prior.sources,
    articleUrls: args.prior.articleUrls,
    publishedAt: args.prior.publishedAt,
    contentHash: args.prior.contentHash,
  });

  const status: StoryChangeStatus = flags.materialChange ? "updated" : "ongoing";

  return {
    status,
    stableId: args.prior.stableId,
    firstSeenAt: args.prior.firstSeenAt,
    lastUpdatedAt: flags.materialChange ? args.nowIso : args.prior.lastUpdatedAt,
    previousState,
    currentState: {
      ...currentState,
      summary: flags.materialChange ? currentState.summary : args.prior.summary,
    },
    changeSummary: flags.materialChange
      ? buildDeterministicChangeSummary(flags, headline, args.prior.headline)
      : null,
    materialChange: flags.materialChange,
    matchedPreviousId: args.prior.clusterId,
  };
}

export function priorToStorySummary(prior: PriorStorySnapshot): StorySummary {
  return {
    headline: prior.headline,
    summary: prior.summary,
    whyItMatters: prior.whyItMatters,
    keyFacts: prior.keyFacts,
    entities: prior.entities,
    confidence: prior.confidence,
    uncertaintyNotes: prior.uncertaintyNotes,
    sourceDisagreements: prior.sourceDisagreements,
    reportedFacts: prior.keyFacts,
    inferences: [],
    contentHash: prior.contentHash,
    cached: true,
    provider: prior.provider,
    model: prior.model,
    isAiGenerated: prior.isAiGenerated,
  };
}

export function buildWhatsNewSummary(args: {
  stories: DailyBriefingStory[];
  comparedToGeneratedAt: string | null;
  now: Date;
}): WhatsNewSummary {
  const newCount = args.stories.filter((s) => s.change.status === "new").length;
  const updatedCount = args.stories.filter((s) => s.change.status === "updated").length;
  const ongoingCount = args.stories.filter((s) => s.change.status === "ongoing").length;

  let label = "What's new";
  if (!args.comparedToGeneratedAt) {
    label = "What's new (first briefing for this topic)";
  } else {
    const prevMs = Date.parse(args.comparedToGeneratedAt);
    if (!Number.isNaN(prevMs)) {
      const hours = (args.now.getTime() - prevMs) / (1000 * 60 * 60);
      if (hours >= 18 && hours < 40) {
        label = "What's new since yesterday";
      } else if (hours >= 40) {
        const days = Math.max(2, Math.round(hours / 24));
        label = `What's new since ${days} days ago`;
      } else if (hours >= 1) {
        label = `What's new since your last briefing (${Math.round(hours)}h ago)`;
      } else {
        label = "What's new since your last briefing";
      }
    }
  }

  const highlights = args.stories
    .filter((story) => story.change.status === "new" || story.change.status === "updated")
    .map((story) => ({
      status: story.change.status,
      headline: story.headline,
      changeSummary: story.change.changeSummary,
    }));

  return {
    comparedToGeneratedAt: args.comparedToGeneratedAt,
    label,
    newCount,
    updatedCount,
    ongoingCount,
    highlights,
  };
}

export function emptyWhatsNew(nowLabel = "What's new"): WhatsNewSummary {
  return {
    comparedToGeneratedAt: null,
    label: nowLabel,
    newCount: 0,
    updatedCount: 0,
    ongoingCount: 0,
    highlights: [],
  };
}

/**
 * Attach final change metadata after summaries exist (fills currentState.summary).
 */
export function finalizeStoryChange(
  change: StoryChangeInfo,
  story: Pick<DailyBriefingStory, "headline" | "summary" | "coveredBy" | "articleUrls" | "publishedAt">,
): StoryChangeInfo {
  return {
    ...change,
    currentState: {
      ...change.currentState,
      headline: story.headline,
      summary: story.summary,
      articleUrls: normalizeUrlSet(story.articleUrls),
      publishedAt: story.publishedAt,
      sources: story.coveredBy
        ? story.coveredBy.split("·").map((part) => part.trim()).filter(Boolean)
        : change.currentState.sources,
    },
  };
}
