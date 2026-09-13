import { beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { resetEnvForTests } from "@/config/env";
import { resetDbConnectionForTests } from "@/lib/db/client";
import { migrate } from "@/lib/db/migrate";
import {
  runSummaryQualityEvaluation,
  loadEvaluationDataset,
} from "@/lib/evaluation/run";
import { scoreSummaryCandidate } from "@/lib/evaluation/score";
import { persistEvaluationRun, listEvaluationRuns } from "@/lib/evaluation/store";

describe("summary quality evaluation", () => {
  beforeEach(() => {
    const dbPath = path.join(
      os.tmpdir(),
      `newspilot-eval-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
    );
    process.env.DATABASE_URL = dbPath;
    resetEnvForTests();
    resetDbConnectionForTests();
    migrate();
  });

  it("loads the fixed dataset and scores grounded vs hallucinated candidates", () => {
    const { cases, datasetHash } = loadEvaluationDataset();
    expect(cases.length).toBeGreaterThanOrEqual(4);
    expect(datasetHash).toHaveLength(16);

    const first = cases[0]!;
    const good = first.candidates.find((c) => c.id.includes("good") || c.id.includes("cautious"))!;
    const bad = first.candidates.find((c) => c.expectHallucination)!;

    const goodScore = scoreSummaryCandidate(first, good, "2026-09-13T12:00:00.000Z");
    const badScore = scoreSummaryCandidate(first, bad, "2026-09-13T12:00:00.000Z");

    expect(goodScore.hallucinationFlagged).toBe(false);
    expect(goodScore.overallScore).toBeGreaterThan(badScore.overallScore);
    expect(badScore.hallucinationFlagged).toBe(true);
    expect(badScore.unsupportedClaimCount).toBeGreaterThan(0);
    expect(goodScore.scores.sourceAttribution.score).toBeGreaterThan(0.4);
  });

  it("produces reproducible metrics and persists results", () => {
    const first = runSummaryQualityEvaluation({
      now: new Date("2026-09-13T12:00:00.000Z"),
      runId: "eval-test-fixed",
    });
    const second = runSummaryQualityEvaluation({
      now: new Date("2026-09-13T12:00:00.000Z"),
      runId: "eval-test-fixed-2",
    });

    expect(first.reproducible).toBe(true);
    expect(first.scorer).toBe("deterministic_v1");
    expect(first.disclaimer.toLowerCase()).toContain("do not represent universal");
    expect(first.datasetHash).toBe(second.datasetHash);
    expect(first.metrics.averageSummaryScore).toBe(second.metrics.averageSummaryScore);
    expect(first.metrics.hallucinationRate).toBe(second.metrics.hallucinationRate);
    expect(first.metrics.expectationMatchRate).toBeGreaterThanOrEqual(0.75);
    expect(first.metrics.citationSourceAccuracy).toBeGreaterThan(0);
    expect(first.metrics.averageSummaryLengthWords).toBeGreaterThan(0);
    expect(first.metrics.unsupportedClaimCount).toBeGreaterThan(0);

    const written = persistEvaluationRun(first);
    expect(written).toBe(first.results.length);
    const runs = listEvaluationRuns(5);
    expect(runs.some((run) => run.runId === "eval-test-fixed")).toBe(true);
  });

  it("keeps the fixture file present for the CLI", () => {
    const fixture = path.join(
      process.cwd(),
      "fixtures/evaluation/summary-quality.json",
    );
    expect(fs.existsSync(fixture)).toBe(true);
  });
});
