import { z } from "zod";

export const coverageAttributedClaimSchema = z.object({
  claim: z.string().min(1).max(500),
  sources: z.array(z.string().min(1)).min(1).max(12),
  articleUrls: z.array(z.string().url()).max(8).default([]),
});

export const coverageSourceReportSchema = z.object({
  source: z.string().min(1).max(120),
  url: z.string().url().optional(),
  title: z.string().max(300).optional(),
  details: z.array(z.string().min(1).max(400)).min(1).max(8),
});

export const coverageFramingDifferenceSchema = z.object({
  description: z.string().min(1).max(500),
  sources: z.array(z.string().min(1)).min(1).max(12),
});

export const coverageConflictSchema = z.object({
  issue: z.string().min(1).max(300),
  positions: z
    .array(
      z.object({
        source: z.string().min(1),
        claim: z.string().min(1).max(400),
        url: z.string().url().optional(),
      }),
    )
    .min(1)
    .max(8),
});

/**
 * Structured source-perspective comparison.
 * Intentionally omits political bias labels.
 */
export const coverageComparisonSchema = z.object({
  commonlyReported: z.array(coverageAttributedClaimSchema).max(12).default([]),
  majorityFacts: z.array(coverageAttributedClaimSchema).max(12).default([]),
  sourceReports: z.array(coverageSourceReportSchema).max(12).default([]),
  framingDifferences: z.array(coverageFramingDifferenceSchema).max(8).default([]),
  conflictingClaims: z.array(coverageConflictSchema).max(8).default([]),
  missingInformation: z.array(z.string().min(1).max(400)).max(8).default([]),
  unresolved: z.array(z.string().min(1).max(400)).max(8).default([]),
});

export type CoverageComparison = z.infer<typeof coverageComparisonSchema>;

export type CoverageSourceArticle = {
  source: string;
  title: string;
  url: string;
};

export type CoverageCompareResult = {
  storyId: string;
  headline: string;
  insufficient: boolean;
  reason?: string;
  sourceCount: number;
  sources: CoverageSourceArticle[];
  comparison: CoverageComparison | null;
  provider: string | null;
  model: string | null;
  /** True when comparison was built without an LLM call. */
  deterministicFallback: boolean;
};

export function parseCoverageComparisonJson(raw: string): CoverageComparison {
  const trimmed = raw.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(unfenced);
  } catch (error) {
    throw new Error(
      `Malformed JSON from coverage comparison: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return coverageComparisonSchema.parse(parsed);
}
