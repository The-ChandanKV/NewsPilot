import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import {
  evaluationDatasetSchema,
  type EvaluationCase,
  type EvaluationRunMetrics,
  type EvaluationRunReport,
  type SummaryEvaluationResult,
} from "@/lib/evaluation/types";
import { scoreEvaluationCase } from "@/lib/evaluation/score";

export const EVALUATION_DISCLAIMER =
  "These metrics are reproducible scores on a fixed sample dataset using deterministic heuristics. They do not represent universal real-world accuracy of the AI pipeline.";

export function defaultDatasetPath(): string {
  return path.join(process.cwd(), "fixtures/evaluation/summary-quality.json");
}

export function loadEvaluationDataset(datasetPath = defaultDatasetPath()): {
  cases: EvaluationCase[];
  datasetHash: string;
  datasetPath: string;
} {
  const absolute = path.resolve(datasetPath);
  const raw = fs.readFileSync(absolute, "utf8");
  const parsed = evaluationDatasetSchema.parse(JSON.parse(raw));
  const datasetHash = createHash("sha256").update(raw).digest("hex").slice(0, 16);
  return { cases: parsed, datasetHash, datasetPath: absolute };
}

export function aggregateEvaluationMetrics(
  results: SummaryEvaluationResult[],
  caseCount: number,
): EvaluationRunMetrics {
  const candidateCount = results.length;
  const hallucinationFlags = results.filter((row) => row.hallucinationFlagged).length;
  const expectationMatches = results.filter((row) => row.expectationMatch).length;
  const unsupportedClaimCount = results.reduce(
    (sum, row) => sum + row.unsupportedClaimCount,
    0,
  );
  const averageSummaryScore =
    candidateCount === 0
      ? 0
      : results.reduce((sum, row) => sum + row.overallScore, 0) / candidateCount;
  const citationSourceAccuracy =
    candidateCount === 0
      ? 0
      : results.reduce((sum, row) => sum + row.sourceAttributionScore, 0) /
        candidateCount;
  const averageSummaryLengthWords =
    candidateCount === 0
      ? 0
      : results.reduce((sum, row) => sum + row.summaryWordCount, 0) / candidateCount;

  return {
    candidateCount,
    caseCount,
    hallucinationRate: candidateCount === 0 ? 0 : hallucinationFlags / candidateCount,
    citationSourceAccuracy,
    averageSummaryScore,
    unsupportedClaimCount,
    averageSummaryLengthWords,
    expectationMatchRate:
      candidateCount === 0 ? 0 : expectationMatches / candidateCount,
  };
}

/**
 * Run the fixed-dataset evaluation. Pure scoring — no live LLM calls.
 */
export function runSummaryQualityEvaluation(options?: {
  datasetPath?: string;
  runId?: string;
  now?: Date;
}): EvaluationRunReport {
  const now = options?.now ?? new Date();
  const startedAt = now.toISOString();
  const { cases, datasetHash, datasetPath } = loadEvaluationDataset(
    options?.datasetPath,
  );

  const results = cases.flatMap((evaluationCase) =>
    scoreEvaluationCase(evaluationCase, startedAt),
  );
  const finishedAt = new Date().toISOString();
  const runId =
    options?.runId ??
    `eval-${datasetHash}-${startedAt.replace(/[:.]/g, "").slice(0, 15)}`;

  return {
    runId,
    datasetPath,
    datasetHash,
    scorer: "deterministic_v1",
    startedAt,
    finishedAt,
    reproducible: true,
    disclaimer: EVALUATION_DISCLAIMER,
    metrics: aggregateEvaluationMetrics(results, cases.length),
    results,
  };
}
