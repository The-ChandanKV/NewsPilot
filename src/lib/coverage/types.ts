import { z } from "zod";
import { AppError } from "@/lib/errors";
import { listStoredDailyBriefings } from "@/lib/jobs/daily-briefing-store";
import { sanitizeUrlForPrompt } from "@/lib/security/urls";
import type { DailyBriefingStory } from "@/types/briefing";

const httpUrlList = z
  .array(z.string().max(2048))
  .max(8)
  .default([])
  .transform((urls) =>
    urls
      .map((url) => sanitizeUrlForPrompt(url))
      .filter((url): url is string => Boolean(url)),
  );

const optionalHttpUrl = z
  .string()
  .max(2048)
  .optional()
  .transform((value) =>
    value ? sanitizeUrlForPrompt(value) ?? undefined : undefined,
  );

export const coverageAttributedClaimSchema = z.object({
  claim: z.string().min(1).max(500),
  sources: z.array(z.string().min(1).max(120)).min(1).max(12),
  articleUrls: httpUrlList,
});

export const coverageSourceReportSchema = z.object({
  source: z.string().min(1).max(120),
  url: optionalHttpUrl,
  title: z.string().max(300).optional(),
  details: z.array(z.string().min(1).max(400)).min(1).max(8),
});

export const coverageFramingDifferenceSchema = z.object({
  description: z.string().min(1).max(500),
  sources: z.array(z.string().min(1).max(120)).min(1).max(12),
});

export const coverageConflictSchema = z.object({
  issue: z.string().min(1).max(300),
  positions: z
    .array(
      z.object({
        source: z.string().min(1).max(120),
        claim: z.string().min(1).max(400),
        url: optionalHttpUrl,
      }),
    )
    .min(1)
    .max(8),
});

/**
 * Structured source-perspective comparison.
 * Intentionally omits political bias labels.
 * Unsafe URL schemes are dropped during parse.
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

const relatedSourceRequestSchema = z.object({
  name: z.string().min(1).max(120),
  title: z.string().max(400).optional().default(""),
  url: z.string().max(2048),
});

/**
 * Cap client-supplied coverage story payloads (untrusted).
 */
export const coverageStoryRequestSchema = z
  .object({
    id: z.string().min(1).max(120),
    headline: z.string().min(1).max(500),
    summary: z.string().max(8000).default(""),
    whyItMatters: z.string().max(2000).optional().default(""),
    keyFacts: z.array(z.string().max(400)).max(20).optional().default([]),
    entities: z.array(z.string().max(120)).max(30).optional().default([]),
    publishedAt: z.string().max(64).nullable().optional().default(null),
    primarySource: z.string().max(120).optional().default(""),
    relatedSources: z
      .array(relatedSourceRequestSchema)
      .max(12)
      .optional()
      .default([]),
    articleUrls: z.array(z.string().max(2048)).max(20).optional().default([]),
    confidence: z.enum(["high", "medium", "low"]).optional().default("medium"),
    uncertaintyNotes: z.array(z.string().max(400)).max(12).optional().default([]),
    sourceDisagreements: z
      .array(
        z.object({
          issue: z.string().max(300),
          positions: z
            .array(
              z.object({
                source: z.string().max(120),
                claim: z.string().max(400),
              }),
            )
            .max(8),
        }),
      )
      .max(8)
      .optional()
      .default([]),
    isAiGenerated: z.boolean().optional().default(true),
    importanceScore: z.number().min(0).max(1).optional().default(0.5),
    coveredBy: z.string().max(400).optional().default(""),
  })
  .passthrough();

export type CoverageStoryRequest = z.infer<typeof coverageStoryRequestSchema>;

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

/**
 * Prefer server-stored story when available; otherwise validate the client payload.
 */
export function resolveCoverageStory(input: {
  storyId?: string;
  story?: unknown;
}): DailyBriefingStory {
  const storyId =
    typeof input.storyId === "string" && input.storyId.trim()
      ? input.storyId.trim().slice(0, 120)
      : typeof input.story === "object" &&
          input.story &&
          "id" in input.story &&
          typeof (input.story as { id?: unknown }).id === "string"
        ? String((input.story as { id: string }).id).slice(0, 120)
        : null;

  if (storyId) {
    const stored = findStoredStoryById(storyId);
    if (stored) return stored;
  }

  if (!input.story || typeof input.story !== "object") {
    throw new AppError("story is required", {
      statusCode: 400,
      code: "INVALID_STORY",
    });
  }

  const parsed = coverageStoryRequestSchema.safeParse(input.story);
  if (!parsed.success) {
    throw new AppError("story payload failed validation", {
      statusCode: 400,
      code: "INVALID_STORY",
      details: { issues: parsed.error.issues.slice(0, 8) },
    });
  }

  return {
    ...(input.story as DailyBriefingStory),
    ...parsed.data,
    relatedSources: parsed.data.relatedSources.map((r) => ({
      name: r.name,
      title: r.title,
      url: r.url,
    })),
  } as DailyBriefingStory;
}

export function findStoredStoryById(storyId: string): DailyBriefingStory | null {
  const briefings = listStoredDailyBriefings({ limit: 60 });
  for (const briefing of briefings) {
    const match = briefing.stories.find((story) => story.id === storyId);
    if (match) return match;
  }
  return null;
}
