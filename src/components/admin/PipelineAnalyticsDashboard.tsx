"use client";

import type {
  PipelineAnalyticsAlert,
  PipelineAnalyticsSnapshot,
} from "@/lib/analytics/types";

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function ms(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(1)}s`;
  return `${Math.round(value)}ms`;
}

function MetricCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
      <p className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
      {hint ? <p className="mt-1 text-xs text-[var(--muted)]">{hint}</p> : null}
    </div>
  );
}

function SparkBars({
  points,
  label,
}: {
  points: Array<{ date: string; value: number }>;
  label: string;
}) {
  const values = points.map((point) => point.value);
  const max = Math.max(1, ...values);
  return (
    <div>
      <p className="mb-2 text-xs uppercase tracking-[0.14em] text-[var(--muted)]">
        {label}
      </p>
      <div className="flex h-24 items-end gap-1">
        {points.map((point) => (
          <div
            key={`${label}-${point.date}`}
            className="flex-1 rounded-t bg-[var(--accent)]/70"
            style={{ height: `${Math.max(4, (point.value / max) * 100)}%` }}
            title={`${point.date}: ${point.value}`}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-[var(--muted)]">
        <span>{points[0]?.date?.slice(5) ?? ""}</span>
        <span>{points[points.length - 1]?.date?.slice(5) ?? ""}</span>
      </div>
    </div>
  );
}

function severityClass(severity: PipelineAnalyticsAlert["severity"]): string {
  if (severity === "critical") return "border-amber-400/50 text-amber-100";
  if (severity === "warning") return "border-amber-200/30 text-amber-100/90";
  return "border-[var(--border)] text-[var(--muted)]";
}

type Props = {
  data: PipelineAnalyticsSnapshot;
};

/**
 * Presentational dashboard — receives precomputed analytics only.
 * No metric math lives here.
 */
export function PipelineAnalyticsDashboard({ data }: Props) {
  const totals = data.totals;

  return (
    <div className="space-y-6">
      <p className="text-xs text-[var(--muted)]">
        Window {data.windowFrom} → {data.windowTo} · generated{" "}
        {new Date(data.generatedAt).toLocaleString()}
      </p>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Articles retrieved"
          value={String(totals.articlesRetrieved)}
        />
        <MetricCard
          label="Duplicate rate"
          value={pct(totals.duplicateRate)}
          hint={`${totals.duplicateArticlesRemoved} removed`}
        />
        <MetricCard
          label="Stories generated"
          value={String(totals.storiesGenerated)}
        />
        <MetricCard
          label="Avg sources / story"
          value={totals.averageSourcesPerStory.toFixed(2)}
        />
        <MetricCard label="AI calls" value={String(totals.aiCalls)} />
        <MetricCard
          label="AI cache hit rate"
          value={pct(totals.aiCacheHitRate)}
          hint={`${totals.aiCacheHits} cache hits`}
        />
        <MetricCard
          label="Failed AI requests"
          value={String(totals.failedAiRequests)}
        />
        <MetricCard
          label="Avg briefing time"
          value={ms(totals.averageBriefingGenerationMs)}
        />
        <MetricCard label="API failures" value={String(totals.apiFailures)} />
        <MetricCard
          label="Briefings stored"
          value={String(totals.briefingCount)}
        />
        <MetricCard
          label="Jobs completed"
          value={String(totals.jobRunsCompleted)}
        />
        <MetricCard
          label="Jobs / topics failed"
          value={`${totals.jobRunsFailed} / ${totals.jobTopicsFailed}`}
        />
      </section>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-5">
        <h2 className="text-lg font-semibold">Operational alerts</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Flags for excessive API/AI usage, duplicates, slow processing, and
          failed providers.
        </p>
        {data.alerts.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--muted)]">
            No major pipeline anomalies detected in this window.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {data.alerts.map((alert) => (
              <li
                key={`${alert.kind}-${alert.title}`}
                className={`rounded-lg border px-3 py-2 text-sm ${severityClass(alert.severity)}`}
              >
                <p className="font-medium">
                  [{alert.severity}] {alert.title}
                </p>
                <p className="mt-1 opacity-90">{alert.detail}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-5">
          <SparkBars
            label="Articles retrieved (daily)"
            points={data.trends.map((day) => ({
              date: day.date,
              value: day.articlesRetrieved,
            }))}
          />
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-5">
          <SparkBars
            label="AI calls (daily)"
            points={data.trends.map((day) => ({
              date: day.date,
              value: day.aiCalls,
            }))}
          />
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-5">
          <SparkBars
            label="Duplicate removals (daily)"
            points={data.trends.map((day) => ({
              date: day.date,
              value: day.duplicateArticlesRemoved,
            }))}
          />
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-5">
          <SparkBars
            label="Avg generation ms (daily)"
            points={data.trends.map((day) => ({
              date: day.date,
              value: Math.round(day.averageBriefingGenerationMs),
            }))}
          />
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-5">
          <SparkBars
            label="API failures (daily)"
            points={data.trends.map((day) => ({
              date: day.date,
              value: day.apiFailures,
            }))}
          />
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-5">
          <SparkBars
            label="Failed AI requests (daily)"
            points={data.trends.map((day) => ({
              date: day.date,
              value: day.failedAiRequests,
            }))}
          />
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-5">
          <h2 className="text-lg font-semibold">Articles per topic</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-[0.12em] text-[var(--muted)]">
                <tr>
                  <th className="py-2">Topic</th>
                  <th>Articles</th>
                  <th>Stories</th>
                  <th>AI</th>
                </tr>
              </thead>
              <tbody>
                {data.articlesPerTopic.slice(0, 12).map((row) => (
                  <tr key={row.topic} className="border-t border-[var(--border)]">
                    <td className="py-2">{row.topic}</td>
                    <td>{row.articlesRetrieved}</td>
                    <td>{row.storiesGenerated}</td>
                    <td>{row.aiCalls}</td>
                  </tr>
                ))}
                {data.articlesPerTopic.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-3 text-[var(--muted)]">
                      No stored briefings in this window.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-5">
          <h2 className="text-lg font-semibold">Most covered topics</h2>
          <ol className="mt-3 space-y-2 text-sm">
            {data.mostCoveredTopics.map((row, index) => (
              <li key={row.topic} className="flex justify-between gap-3">
                <span>
                  {index + 1}. {row.topic}
                </span>
                <span className="text-[var(--muted)]">
                  {row.storiesGenerated} stories · {row.briefingCount} briefing
                  {row.briefingCount === 1 ? "" : "s"}
                </span>
              </li>
            ))}
            {data.mostCoveredTopics.length === 0 ? (
              <li className="text-[var(--muted)]">No coverage data yet.</li>
            ) : null}
          </ol>
        </div>
      </section>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-5">
        <h2 className="text-lg font-semibold">Failed providers</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.12em] text-[var(--muted)]">
              <tr>
                <th className="py-2">Provider</th>
                <th>Kind</th>
                <th>Count</th>
                <th>Last code</th>
              </tr>
            </thead>
            <tbody>
              {data.failedProviders.map((row) => (
                <tr
                  key={`${row.kind}-${row.provider}`}
                  className="border-t border-[var(--border)]"
                >
                  <td className="py-2">{row.provider}</td>
                  <td>{row.kind}</td>
                  <td>{row.count}</td>
                  <td className="text-[var(--muted)]">{row.lastCode ?? "—"}</td>
                </tr>
              ))}
              {data.failedProviders.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-3 text-[var(--muted)]">
                    No recorded provider failures in this window.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-5">
        <h2 className="text-lg font-semibold">Daily trend table</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.12em] text-[var(--muted)]">
              <tr>
                <th className="py-2">Date</th>
                <th>Articles</th>
                <th>Dup rate</th>
                <th>Stories</th>
                <th>AI calls</th>
                <th>Cache</th>
                <th>Avg time</th>
                <th>API fail</th>
                <th>AI fail</th>
              </tr>
            </thead>
            <tbody>
              {data.trends.map((day) => (
                <tr key={day.date} className="border-t border-[var(--border)]">
                  <td className="py-2">{day.date}</td>
                  <td>{day.articlesRetrieved}</td>
                  <td>{pct(day.duplicateRate)}</td>
                  <td>{day.storiesGenerated}</td>
                  <td>{day.aiCalls}</td>
                  <td>{pct(day.aiCacheHitRate)}</td>
                  <td>{ms(day.averageBriefingGenerationMs)}</td>
                  <td>{day.apiFailures}</td>
                  <td>{day.failedAiRequests}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
