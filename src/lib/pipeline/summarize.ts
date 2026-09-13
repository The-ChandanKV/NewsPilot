import { getEnv } from "@/config/env";
import { summaryCache } from "@/lib/cache/memory";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { recordAnalyticsEvent } from "@/lib/analytics/events";
import {
  buildSummarizationInput,
  buildSummarizerUserPrompt,
  storyContentHash,
  SUMMARIZER_SYSTEM_PROMPT,
} from "@/lib/pipeline/summarize-input";
import {
  parseStorySummaryJson,
  type StorySummaryPayload,
} from "@/lib/pipeline/summary-schema";
import { getLlmProvider } from "@/lib/providers/llm/router";
import type { LlmProvider } from "@/lib/providers/llm/types";
import type {
  AiProviderName,
  StoryCluster,
  StorySummary,
  SummarizedStory,
} from "@/types/briefing";

export type SummarizeStoriesResult = {
  topic: string;
  summarizedAt: string;
  provider: AiProviderName;
  llmCalls: number;
  cacheHits: number;
  stories: SummarizedStory[];
};

function cacheKey(provider: AiProviderName, hash: string): string {
  return `summary:${provider}:${hash}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function completeWithValidation(
  provider: LlmProvider,
  userPrompt: string,
  maxTokens: number,
  maxAttempts: number,
  context?: { topic?: string; storyId?: string },
): Promise<{ payload: StorySummaryPayload; model: string }> {
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const repairHint =
        attempt === 0
          ? ""
          : "\n\nPrevious response was invalid. Return ONLY valid JSON matching the schema. No markdown.";

      const completion = await provider.complete({
        messages: [
          { role: "system", content: SUMMARIZER_SYSTEM_PROMPT },
          { role: "user", content: userPrompt + repairHint },
        ],
        responseFormat: "json",
        maxTokens,
        temperature: 0.2,
      });

      const payload = parseStorySummaryJson(completion.content);
      return { payload, model: completion.model };
    } catch (error) {
      lastError = error;
      const code = error instanceof AppError ? error.code : "AI_SUMMARY_ATTEMPT_FAILED";
      const retryable =
        error instanceof AppError
          ? ["AI_RATE_LIMITED", "AI_PROVIDER_TIMEOUT", "AI_PROVIDER_NETWORK_ERROR", "AI_PROVIDER_HTTP_ERROR"].includes(
              error.code,
            )
          : true;

      logger.warn("Story summary attempt failed", {
        attempt: attempt + 1,
        error: error instanceof Error ? error.message : String(error),
        retryable,
      });

      recordAnalyticsEvent({
        kind: attempt >= maxAttempts - 1 || !retryable ? "ai_request_failure" : "ai_request_retry",
        topic: context?.topic,
        provider: provider.name,
        code,
        detail: error instanceof Error ? error.message : String(error),
        meta: {
          attempt: attempt + 1,
          storyId: context?.storyId ?? null,
        },
      });

      if (!retryable || attempt >= maxAttempts - 1) {
        break;
      }
      await sleep(400 * 2 ** attempt);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new AppError("Failed to summarize story", {
        statusCode: 502,
        code: "AI_SUMMARY_FAILED",
      });
}

function fallbackSummary(
  cluster: StoryCluster,
  contentHash: string,
  provider: AiProviderName,
  reason: string,
): StorySummary {
  const descriptions = [cluster.representativeArticle, ...cluster.relatedArticles]
    .map((article) => article.description)
    .filter((value): value is string => Boolean(value && value.trim()))
    .slice(0, 2);

  const summary =
    descriptions.length > 0
      ? descriptions.join(" ")
      : `Reporting from ${cluster.sources.join(", ") || "available sources"} on: ${cluster.primaryHeadline}`;

  return {
    headline: cluster.primaryHeadline,
    summary: summary.slice(0, 1200),
    whyItMatters:
      "AI summarization was unavailable; this text is taken from source headlines/snippets only.",
    keyFacts: [cluster.primaryHeadline],
    entities: [],
    confidence: "low",
    uncertaintyNotes: [
      `AI summary unavailable (${reason}). Treat this as an unsummarized source extract.`,
    ],
    sourceDisagreements: [],
    reportedFacts: descriptions.slice(0, 3),
    inferences: [],
    contentHash,
    cached: false,
    provider,
    isAiGenerated: false,
  };
}

/**
 * Summarize ONE story cluster with a single LLM call (cached by content hash).
 * Pass `reuseSummary` to skip LLM when a prior briefing already covered this content.
 */
export async function summarizeStoryCluster(
  cluster: StoryCluster,
  topic: string,
  options?: {
    provider?: LlmProvider;
    forceRefresh?: boolean;
    /** Reuse a prior summary when the story has not materially changed. */
    reuseSummary?: StorySummary;
  },
): Promise<StorySummary> {
  const env = getEnv();
  const provider = options?.provider ?? getLlmProvider();
  const maxArticles = env.AI_SUMMARY_MAX_ARTICLES_PER_CLUSTER;
  const hash = storyContentHash(cluster, topic, maxArticles);
  const key = cacheKey(provider.name, hash);

  if (options?.reuseSummary) {
    logger.info("Reusing prior briefing summary (no material change)", {
      storyId: cluster.id,
      hash,
    });
    return {
      ...options.reuseSummary,
      contentHash: hash,
      cached: true,
    };
  }

  if (!options?.forceRefresh) {
    const cached = summaryCache.get<StorySummary>(key);
    if (cached) {
      logger.info("Summary cache hit", { storyId: cluster.id, hash });
      return { ...cached, cached: true, contentHash: hash };
    }
  }

  if (!provider.isConfigured()) {
    return fallbackSummary(cluster, hash, provider.name, "provider not configured");
  }

  const input = buildSummarizationInput(cluster, topic, maxArticles);
  const userPrompt = buildSummarizerUserPrompt(input);

  try {
    const { payload, model } = await completeWithValidation(
      provider,
      userPrompt,
      env.AI_MAX_OUTPUT_TOKENS,
      Math.max(1, env.AI_PROVIDER_MAX_RETRIES + 1),
      { topic, storyId: cluster.id },
    );

    const summary: StorySummary = {
      headline: payload.headline,
      summary: payload.summary,
      whyItMatters: payload.whyItMatters,
      keyFacts: payload.keyFacts,
      entities: payload.entities,
      confidence: payload.confidence,
      uncertaintyNotes: payload.uncertaintyNotes ?? [],
      sourceDisagreements: payload.sourceDisagreements ?? [],
      reportedFacts: payload.reportedFacts ?? [],
      inferences: payload.inferences ?? [],
      contentHash: hash,
      cached: false,
      provider: provider.name,
      model,
      isAiGenerated: true,
    };

    summaryCache.set(key, summary, env.AI_SUMMARY_CACHE_TTL_SECONDS);
    return summary;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.error("Story summarization failed; using fallback", {
      storyId: cluster.id,
      reason,
    });
    return fallbackSummary(cluster, hash, provider.name, reason);
  }
}

/**
 * Summarize the top important story clusters — ONE LLM call per cluster.
 * Never calls the LLM once per article.
 * `reuseByClusterId` skips LLM for ongoing (unchanged) stories.
 */
export async function summarizeStoryClusters(
  clusters: StoryCluster[],
  topic: string,
  options?: {
    provider?: LlmProvider;
    maxStories?: number;
    forceRefresh?: boolean;
    reuseByClusterId?: Map<string, StorySummary>;
  },
): Promise<SummarizeStoriesResult> {
  const env = getEnv();
  const provider = options?.provider ?? getLlmProvider();
  const limit = options?.maxStories ?? env.MAX_STORIES_TO_SUMMARIZE;
  const selected = clusters.slice(0, limit);

  let llmCalls = 0;
  let cacheHits = 0;
  const stories: SummarizedStory[] = [];

  // Sequential to keep rate limits predictable and costs controlled.
  for (const cluster of selected) {
    const reuseSummary = options?.reuseByClusterId?.get(cluster.id);
    const ai = await summarizeStoryCluster(cluster, topic, {
      provider,
      forceRefresh: options?.forceRefresh,
      reuseSummary,
    });

    if (ai.cached) {
      cacheHits += 1;
    } else if (ai.isAiGenerated) {
      llmCalls += 1;
    }

    stories.push({ ...cluster, ai });
  }

  // Attach unsummarized lower-ranked clusters without LLM calls.
  for (const cluster of clusters.slice(limit)) {
    const hash = storyContentHash(
      cluster,
      topic,
      env.AI_SUMMARY_MAX_ARTICLES_PER_CLUSTER,
    );
    stories.push({
      ...cluster,
      ai: fallbackSummary(
        cluster,
        hash,
        provider.name,
        "below summarization rank cutoff",
      ),
    });
  }

  logger.info("Story summarization complete", {
    topic,
    selected: selected.length,
    llmCalls,
    cacheHits,
    provider: provider.name,
  });

  return {
    topic,
    summarizedAt: new Date().toISOString(),
    provider: provider.name,
    llmCalls,
    cacheHits,
    stories,
  };
}
