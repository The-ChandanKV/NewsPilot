import { z } from "zod";
import { getEnv } from "@/config/env";

/**
 * Central scoring / clustering knobs.
 * Override via environment variables — do not hardcode weights in pipeline code.
 */
const scoringEnvSchema = z.object({
  RANK_WEIGHT_RELEVANCE: z.coerce.number().min(0).max(1).default(0.35),
  RANK_WEIGHT_FRESHNESS: z.coerce.number().min(0).max(1).default(0.25),
  RANK_WEIGHT_SOURCE_DIVERSITY: z.coerce.number().min(0).max(1).default(0.2),
  RANK_WEIGHT_SOURCE_QUALITY: z.coerce.number().min(0).max(1).default(0.2),

  /** Jaccard threshold for near-duplicate headlines (merge aggressively). */
  HEADLINE_NEAR_DUPLICATE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.85),
  /** Jaccard threshold for clustering related stories/events. */
  STORY_CLUSTER_SIMILARITY_THRESHOLD: z.coerce.number().min(0).max(1).default(0.5),

  /** Hours used for freshness decay curve (usually matches NEWS_RECENCY_HOURS). */
  FRESHNESS_HALF_LIFE_HOURS: z.coerce.number().positive().default(24),

  /** Unique sources at which diversity score saturates at 1.0. */
  SOURCE_DIVERSITY_SATURATION: z.coerce.number().int().positive().default(5),

  SOURCE_TIER1_SCORE: z.coerce.number().min(0).max(1).default(1),
  SOURCE_TIER2_SCORE: z.coerce.number().min(0).max(1).default(0.7),
  SOURCE_TIER3_SCORE: z.coerce.number().min(0).max(1).default(0.4),
});

export type ScoringConfig = z.infer<typeof scoringEnvSchema> & {
  /** Normalized weights that sum to 1. */
  weights: {
    relevance: number;
    freshness: number;
    sourceDiversity: number;
    sourceQuality: number;
  };
};

let cached: ScoringConfig | null = null;

function normalizeWeights(config: z.infer<typeof scoringEnvSchema>) {
  const raw = {
    relevance: config.RANK_WEIGHT_RELEVANCE,
    freshness: config.RANK_WEIGHT_FRESHNESS,
    sourceDiversity: config.RANK_WEIGHT_SOURCE_DIVERSITY,
    sourceQuality: config.RANK_WEIGHT_SOURCE_QUALITY,
  };
  const sum =
    raw.relevance + raw.freshness + raw.sourceDiversity + raw.sourceQuality || 1;

  return {
    relevance: raw.relevance / sum,
    freshness: raw.freshness / sum,
    sourceDiversity: raw.sourceDiversity / sum,
    sourceQuality: raw.sourceQuality / sum,
  };
}

export function getScoringConfig(overrides?: Partial<z.infer<typeof scoringEnvSchema>>): ScoringConfig {
  // Allow tests to pass overrides without mutating global cache permanently.
  if (overrides) {
    const parsed = scoringEnvSchema.parse({ ...process.env, ...overrides });
    return { ...parsed, weights: normalizeWeights(parsed) };
  }

  if (cached) {
    return cached;
  }

  // Touch getEnv so app env is validated first in production paths.
  getEnv();

  const parsed = scoringEnvSchema.parse(process.env);
  cached = { ...parsed, weights: normalizeWeights(parsed) };
  return cached;
}

/** Reset cache — used by tests when mutating env. */
export function resetScoringConfigCache(): void {
  cached = null;
}
