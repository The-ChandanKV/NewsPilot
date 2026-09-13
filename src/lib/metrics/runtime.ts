/**
 * Process-lifetime pipeline metrics for the development cost/perf view.
 * Complements durable daily-job analytics with live briefing activity.
 */

export type PipelineRunMetrics = {
  at: string;
  topic: string;
  durationMs: number;
  aiCalls: number;
  cacheHits: number;
  articlesProcessed: number;
  duplicateArticlesRemoved: number;
  storiesGenerated: number;
  fromBriefingCache: boolean;
};

export type RuntimePipelineMetrics = {
  aiCalls: number;
  cacheHits: number;
  summaryCacheHits: number;
  newsCacheHits: number;
  briefingCacheHits: number;
  durableSummaryHits: number;
  aiDedupedCalls: number;
  articlesProcessed: number;
  duplicateArticlesRemoved: number;
  storiesGenerated: number;
  briefingRuns: number;
  totalProcessingMs: number;
  averageProcessingTimeMs: number;
  recentRuns: PipelineRunMetrics[];
};

const MAX_RECENT = 40;

const totals = {
  aiCalls: 0,
  cacheHits: 0,
  summaryCacheHits: 0,
  newsCacheHits: 0,
  briefingCacheHits: 0,
  durableSummaryHits: 0,
  aiDedupedCalls: 0,
  articlesProcessed: 0,
  duplicateArticlesRemoved: 0,
  storiesGenerated: 0,
  briefingRuns: 0,
  totalProcessingMs: 0,
};

const recentRuns: PipelineRunMetrics[] = [];

export function recordSummaryCacheHit(kind: "memory" | "durable" | "reuse"): void {
  totals.cacheHits += 1;
  totals.summaryCacheHits += 1;
  if (kind === "durable") totals.durableSummaryHits += 1;
}

export function recordNewsCacheHit(): void {
  totals.cacheHits += 1;
  totals.newsCacheHits += 1;
}

export function recordBriefingCacheHit(): void {
  totals.cacheHits += 1;
  totals.briefingCacheHits += 1;
}

export function recordAiCall(count = 1): void {
  totals.aiCalls += count;
}

export function recordAiDedupedCall(count = 1): void {
  totals.aiDedupedCalls += count;
  totals.cacheHits += count;
}

export function recordBriefingRun(run: Omit<PipelineRunMetrics, "at"> & { at?: string }): void {
  const entry: PipelineRunMetrics = {
    at: run.at ?? new Date().toISOString(),
    topic: run.topic,
    durationMs: run.durationMs,
    aiCalls: run.aiCalls,
    cacheHits: run.cacheHits,
    articlesProcessed: run.articlesProcessed,
    duplicateArticlesRemoved: run.duplicateArticlesRemoved,
    storiesGenerated: run.storiesGenerated,
    fromBriefingCache: run.fromBriefingCache,
  };

  totals.briefingRuns += 1;
  totals.totalProcessingMs += entry.durationMs;
  totals.articlesProcessed += entry.articlesProcessed;
  totals.duplicateArticlesRemoved += entry.duplicateArticlesRemoved;
  totals.storiesGenerated += entry.storiesGenerated;
  // aiCalls / cacheHits for the run are already counted at call sites when
  // they happen; for briefing-cache hits we still bump cache via recordBriefingCacheHit.

  recentRuns.unshift(entry);
  if (recentRuns.length > MAX_RECENT) {
    recentRuns.length = MAX_RECENT;
  }
}

export function getRuntimePipelineMetrics(): RuntimePipelineMetrics {
  return {
    ...totals,
    averageProcessingTimeMs:
      totals.briefingRuns > 0
        ? totals.totalProcessingMs / totals.briefingRuns
        : 0,
    recentRuns: [...recentRuns],
  };
}

export function resetRuntimePipelineMetricsForTests(): void {
  totals.aiCalls = 0;
  totals.cacheHits = 0;
  totals.summaryCacheHits = 0;
  totals.newsCacheHits = 0;
  totals.briefingCacheHits = 0;
  totals.durableSummaryHits = 0;
  totals.aiDedupedCalls = 0;
  totals.articlesProcessed = 0;
  totals.duplicateArticlesRemoved = 0;
  totals.storiesGenerated = 0;
  totals.briefingRuns = 0;
  totals.totalProcessingMs = 0;
  recentRuns.length = 0;
}
