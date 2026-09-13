import { z } from "zod";

export const evaluationArticleSchema = z.object({
  source: z.string().min(1),
  title: z.string().min(1),
  description: z.string().nullable(),
  url: z.string().url(),
  publishedAt: z.string().nullable().optional(),
});

export const evaluationCandidateSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  headline: z.string().min(1),
  summary: z.string().min(1),
  whyItMatters: z.string().min(1),
  keyFacts: z.array(z.string()).default([]),
  expectHallucination: z.boolean(),
  expectUnsupported: z.boolean(),
});

export const evaluationCaseSchema = z.object({
  id: z.string().min(1),
  topic: z.string().min(1),
  notes: z.string().optional(),
  articles: z.array(evaluationArticleSchema).min(1),
  requiredEntities: z.array(z.string()).default([]),
  requiredFacts: z.array(z.string()).default([]),
  allowedSources: z.array(z.string()).default([]),
  candidates: z.array(evaluationCandidateSchema).min(1),
});

export const evaluationDatasetSchema = z.array(evaluationCaseSchema).min(1);

export type EvaluationArticle = z.infer<typeof evaluationArticleSchema>;
export type EvaluationCandidate = z.infer<typeof evaluationCandidateSchema>;
export type EvaluationCase = z.infer<typeof evaluationCaseSchema>;

export type DimensionScore = {
  score: number;
  notes: string[];
};

export type SummaryEvaluationScores = {
  factualConsistency: DimensionScore;
  sourceAttribution: DimensionScore;
  completeness: DimensionScore;
  relevance: DimensionScore;
  conciseness: DimensionScore;
  unsupportedClaims: DimensionScore;
  hallucinations: DimensionScore;
};

export type SummaryEvaluationResult = {
  caseId: string;
  candidateId: string;
  topic: string;
  label: string;
  scores: SummaryEvaluationScores;
  overallScore: number;
  summaryWordCount: number;
  unsupportedClaimCount: number;
  hallucinationFlagged: boolean;
  sourceAttributionScore: number;
  expectHallucination: boolean;
  expectUnsupported: boolean;
  expectationMatch: boolean;
  evaluatedAt: string;
};

export type EvaluationRunMetrics = {
  candidateCount: number;
  caseCount: number;
  hallucinationRate: number;
  citationSourceAccuracy: number;
  averageSummaryScore: number;
  unsupportedClaimCount: number;
  averageSummaryLengthWords: number;
  expectationMatchRate: number;
};

export type EvaluationRunReport = {
  runId: string;
  datasetPath: string;
  datasetHash: string;
  scorer: "deterministic_v1";
  startedAt: string;
  finishedAt: string;
  reproducible: true;
  disclaimer: string;
  metrics: EvaluationRunMetrics;
  results: SummaryEvaluationResult[];
};
