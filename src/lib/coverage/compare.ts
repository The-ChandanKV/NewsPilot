import { getEnv } from "@/config/env";
import {
  buildCoverageUserPrompt,
  buildDeterministicComparison,
  canCompareCoverage,
  collectSourceArticles,
  COVERAGE_SYSTEM_PROMPT,
  scrubComparison,
} from "@/lib/coverage/build";
import {
  parseCoverageComparisonJson,
  type CoverageCompareResult,
} from "@/lib/coverage/types";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { getAIProvider } from "@/lib/providers/llm/router";
import type { LlmProvider } from "@/lib/providers/llm/types";
import type { DailyBriefingStory } from "@/types/briefing";

export type CompareCoverageOptions = {
  story: DailyBriefingStory;
  topic?: string;
  /** Prefer AI when configured; fall back to deterministic scaffold on failure. */
  allowDeterministicFallback?: boolean;
};

/**
 * Source perspective comparison for a multi-source story cluster.
 * Uses AIProvider when available; never invents political bias labels.
 */
export async function compareStoryCoverage(
  options: CompareCoverageOptions,
  deps?: { provider?: LlmProvider },
): Promise<CoverageCompareResult> {
  const story = options.story;
  if (!story?.id || !story.headline) {
    throw new AppError("Story payload is required", {
      statusCode: 400,
      code: "INVALID_STORY",
    });
  }

  const sources = collectSourceArticles(story);
  if (!canCompareCoverage(story) || sources.length < 2) {
    return {
      storyId: story.id,
      headline: story.headline,
      insufficient: true,
      reason:
        "Need at least two distinct source articles on this story to compare coverage.",
      sourceCount: sources.length,
      sources,
      comparison: null,
      provider: null,
      model: null,
      deterministicFallback: false,
    };
  }

  const allowFallback = options.allowDeterministicFallback !== false;
  const provider = deps?.provider ?? getAIProvider();

  if (!provider.isConfigured()) {
    if (!allowFallback) {
      throw new AppError("AI provider is not configured", {
        statusCode: 503,
        code: "AI_NOT_CONFIGURED",
      });
    }
    logger.info("Coverage compare using deterministic fallback (AI not configured)", {
      storyId: story.id,
      sourceCount: sources.length,
    });
    return {
      storyId: story.id,
      headline: story.headline,
      insufficient: false,
      sourceCount: sources.length,
      sources,
      comparison: buildDeterministicComparison(story, sources),
      provider: null,
      model: null,
      deterministicFallback: true,
    };
  }

  try {
    const env = getEnv();
    const completion = await provider.complete({
      messages: [
        { role: "system", content: COVERAGE_SYSTEM_PROMPT },
        {
          role: "user",
          content: buildCoverageUserPrompt({
            story,
            sources,
            topic: options.topic,
          }),
        },
      ],
      responseFormat: "json",
      maxTokens: Math.min(env.AI_MAX_OUTPUT_TOKENS, 1600),
      temperature: 0.2,
    });

    const comparison = scrubComparison(
      parseCoverageComparisonJson(completion.content),
    );

    logger.info("Coverage comparison generated", {
      storyId: story.id,
      sourceCount: sources.length,
      provider: completion.provider,
    });

    return {
      storyId: story.id,
      headline: story.headline,
      insufficient: false,
      sourceCount: sources.length,
      sources,
      comparison,
      provider: completion.provider,
      model: completion.model,
      deterministicFallback: false,
    };
  } catch (error) {
    logger.warn("Coverage comparison AI failed; falling back", {
      storyId: story.id,
      error: error instanceof Error ? error.message : String(error),
    });
    if (!allowFallback) throw error;

    return {
      storyId: story.id,
      headline: story.headline,
      insufficient: false,
      sourceCount: sources.length,
      sources,
      comparison: buildDeterministicComparison(story, sources),
      provider: provider.name,
      model: null,
      deterministicFallback: true,
    };
  }
}
