import { desc, eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { getDb } from "@/lib/db/client";
import { summaryEvaluations } from "@/lib/db/schema";
import type { EvaluationRunReport } from "@/lib/evaluation/types";
import { migrate } from "@/lib/db/migrate";

export function persistEvaluationRun(report: EvaluationRunReport): number {
  migrate();
  const db = getDb();
  let written = 0;

  for (const result of report.results) {
    db.insert(summaryEvaluations)
      .values({
        id: randomUUID(),
        runId: report.runId,
        caseId: result.caseId,
        candidateId: result.candidateId,
        topic: result.topic,
        scorer: report.scorer,
        datasetHash: report.datasetHash,
        overallScore: result.overallScore,
        hallucinationFlagged: result.hallucinationFlagged,
        unsupportedClaimCount: result.unsupportedClaimCount,
        summaryWordCount: result.summaryWordCount,
        expectationMatch: result.expectationMatch,
        scoresJson: JSON.stringify(result.scores),
        metricsJson: JSON.stringify(report.metrics),
        disclaimer: report.disclaimer,
        createdAt: result.evaluatedAt,
      })
      .run();
    written += 1;
  }

  return written;
}

export function listEvaluationRuns(limit = 20): Array<{
  runId: string;
  datasetHash: string;
  createdAt: string;
  candidateCount: number;
  averageSummaryScore: number;
}> {
  migrate();
  const rows = getDb()
    .select()
    .from(summaryEvaluations)
    .orderBy(desc(summaryEvaluations.createdAt))
    .limit(limit * 20)
    .all();

  const byRun = new Map<
    string,
    {
      runId: string;
      datasetHash: string;
      createdAt: string;
      candidateCount: number;
      scoreSum: number;
    }
  >();

  for (const row of rows) {
    const existing = byRun.get(row.runId);
    if (existing) {
      existing.candidateCount += 1;
      existing.scoreSum += row.overallScore;
    } else {
      byRun.set(row.runId, {
        runId: row.runId,
        datasetHash: row.datasetHash,
        createdAt: row.createdAt,
        candidateCount: 1,
        scoreSum: row.overallScore,
      });
    }
  }

  return [...byRun.values()]
    .map((row) => ({
      runId: row.runId,
      datasetHash: row.datasetHash,
      createdAt: row.createdAt,
      candidateCount: row.candidateCount,
      averageSummaryScore: row.scoreSum / row.candidateCount,
    }))
    .slice(0, limit);
}

export function getEvaluationRunResults(runId: string) {
  migrate();
  return getDb()
    .select()
    .from(summaryEvaluations)
    .where(eq(summaryEvaluations.runId, runId))
    .all();
}
