# AI News Quality Evaluation

This document describes NewsPilot’s **summary quality evaluation pipeline**.

The goal is to demonstrate that AI-generated (and candidate) summaries are **tested with reproducible checks**, not blindly trusted.

> **Important:** Metrics from this pipeline are scores on a **fixed sample dataset** using **deterministic heuristics**. They do **not** claim universal real-world accuracy.

## Evaluation methodology

1. Load a versioned fixture dataset: `fixtures/evaluation/summary-quality.json`.
2. For each case, score every candidate summary with the deterministic scorer `deterministic_v1` (`src/lib/evaluation/score.ts`).
3. Aggregate run metrics (`src/lib/evaluation/run.ts`).
4. Optionally persist per-candidate results to SQLite (`summary_evaluations`) and write a JSON report under `artifacts/evaluation/`.

Default command (no live LLM calls):

```bash
npm run eval:summaries
```

Options:

```bash
npm run eval:summaries -- --no-persist
npm run eval:summaries -- --dataset=./fixtures/evaluation/summary-quality.json
npm run eval:summaries -- --out=./artifacts/evaluation
```

Reproducibility comes from:

- a fixed dataset file (hashed in the report as `datasetHash`)
- a named scorer version (`deterministic_v1`)
- no nondeterministic model calls in the default path

## Sample dataset

Path: `fixtures/evaluation/summary-quality.json`

Cases cover representative situations:

| Case id | Scenario |
|---|---|
| `openai-enterprise-launch` | Multi-source launch with pricing disagreement |
| `space-launch-delay` | Weather delay with clear attribution |
| `cyber-patch-advisory` | Security advisory / patch urgency |
| `thin-single-source` | Thin single-source funding note |

Each case includes:

- source articles (title, description, source, URL)
- required entities/facts for completeness checks
- allowed sources for attribution checks
- **grounded** and **intentionally bad** candidate summaries with expected flags

## Scoring criteria

Each candidate is scored **0–1** on seven dimensions:

1. **Factual consistency** — content-token overlap between summary text and source corpus.
2. **Source attribution** — whether known outlet names appear in the summary.
3. **Completeness** — coverage of required entities and facts for the case.
4. **Relevance** — overlap with topic / primary headline tokens.
5. **Conciseness** — summary body length preference (~25–120 words).
6. **Unsupported claims** — numbers / proper-noun-like tokens absent from sources.
7. **Hallucinations** — invented outlet cues, severe unsupported load, or absolute/overconfident claims not grounded in sources.

**Overall score** = mean of the seven dimension scores.

Also recorded:

- `hallucinationFlagged` (boolean)
- `unsupportedClaimCount`
- `summaryWordCount`
- `expectationMatch` (whether flags match dataset expectations)

## Aggregate metrics

| Metric | Meaning |
|---|---|
| `hallucinationRate` | Share of candidates flagged for hallucination markers |
| `citationSourceAccuracy` | Average source-attribution dimension score |
| `averageSummaryScore` | Mean overall score |
| `unsupportedClaimCount` | Total unsupported claim markers across candidates |
| `averageSummaryLengthWords` | Mean summary body length |
| `expectationMatchRate` | How often scorer flags match labeled expectations |

## Limitations

- Heuristic scoring can miss fluent hallucinations that reuse only source vocabulary.
- Proper-noun extraction is approximate; it is not a full NER / NLI system.
- Source attribution checks for outlet name mentions, not deep citation graphs.
- The dataset is small and curated; it is not a production traffic sample.
- Live model outputs are **not** scored in the default reproducible path.
- Do not treat high fixture scores as proof of real-world reliability.

## Where results are stored

- JSON report: `artifacts/evaluation/<runId>.json`
- SQLite table: `summary_evaluations` (when persistence is enabled)

## Related code

- `src/lib/evaluation/` — dataset load, scoring, aggregation, persistence
- `scripts/run-summary-evaluation.ts` — CLI entrypoint
- `fixtures/evaluation/summary-quality.json` — fixed sample dataset
