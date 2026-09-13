/**
 * Reproducible AI summary quality evaluation against a fixed dataset.
 *
 * Usage:
 *   npm run eval:summaries
 *   npm run eval:summaries -- --no-persist
 *   npm run eval:summaries -- --dataset=./fixtures/evaluation/summary-quality.json
 *
 * Does NOT call live LLMs by default — scores fixed candidates for reproducibility.
 */
import fs from "fs";
import path from "path";
import { migrate } from "../src/lib/db/migrate";
import { runSummaryQualityEvaluation } from "../src/lib/evaluation/run";
import { persistEvaluationRun } from "../src/lib/evaluation/store";

function argValue(prefix: string): string | undefined {
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

async function main() {
  migrate();
  const datasetPath = argValue("--dataset=");
  const noPersist = process.argv.includes("--no-persist");
  const outDir =
    argValue("--out=") ?? path.join(process.cwd(), "artifacts/evaluation");

  const report = runSummaryQualityEvaluation({ datasetPath });

  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${report.runId}.json`);
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2), "utf8");

  let persisted = 0;
  if (!noPersist) {
    persisted = persistEvaluationRun(report);
  }

  console.log(
    JSON.stringify(
      {
        runId: report.runId,
        datasetHash: report.datasetHash,
        scorer: report.scorer,
        reproducible: report.reproducible,
        disclaimer: report.disclaimer,
        metrics: report.metrics,
        reportPath: outFile,
        persistedRows: persisted,
      },
      null,
      2,
    ),
  );

  // Fail CI if expectation labels diverge too often (dataset regression guard).
  if (report.metrics.expectationMatchRate < 0.75) {
    console.error(
      `Expectation match rate too low: ${report.metrics.expectationMatchRate}`,
    );
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
