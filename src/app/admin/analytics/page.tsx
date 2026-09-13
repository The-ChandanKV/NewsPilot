"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import type { PipelineAnalyticsSnapshot } from "@/lib/analytics/types";

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
  values,
  label,
}: {
  values: number[];
  label: string;
}) {
  const max = Math.max(1, ...values);
  return (
    <div>
      <p className="mb-2 text-xs uppercase tracking-[0.14em] text-[var(--muted)]">
        {label}
      </p>
      <div className="flex h-24 items-end gap-1">
        {values.map((value, index) => (
          <div
            key={`${label}-${index}`}
            className="flex-1 rounded-t bg-[var(--accent)]/70"
            style={{ height: `${Math.max(4, (value / max) * 100)}%` }}
            title={String(value)}
          />
        ))}
      </div>
    </div>
  );
}

export default function AdminAnalyticsPage() {
  const [days, setDays] = useState(14);
  const [secret, setSecret] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PipelineAnalyticsSnapshot | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ days: String(days) });
      if (secret.trim()) params.set("secret", secret.trim());
      const response = await fetch(`/api/admin/analytics?${params.toString()}`, {
        headers: secret.trim()
          ? { "x-admin-secret": secret.trim() }
          : undefined,
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Failed to load analytics");
      }
      setData(payload as PipelineAnalyticsSnapshot);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [days, secret]);

  useEffect(() => {
    void load();
  }, [load]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void load();
  }

  const totals = data?.totals;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-6 py-12">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.2em] text-[var(--muted)]">
            Admin · developer
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            Pipeline analytics
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
            Internal view of news retrieval, dedupe, AI usage, and provider
            failures. No API keys or personal data are shown.
          </p>
        </div>
        <a href="/" className="text-sm text-[var(--accent)] underline">
          Back to app
        </a>
      </header>

      <form
        onSubmit={handleSubmit}
        className="flex flex-wrap items-end gap-3 rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4"
      >
        <label className="text-sm">
          <span className="text-[var(--muted)]">Window (days)</span>
          <input
            type="number"
            min={1}
            max={90}
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
            className="mt-1 block w-24 rounded-lg border border-[var(--border)] bg-transparent px-3 py-2"
          />
        </label>
        <label className="min-w-[220px] flex-1 text-sm">
          <span className="text-[var(--muted)]">Admin secret (if configured)</span>
          <input
            type="password"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            autoComplete="off"
            className="mt-1 block w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2"
            placeholder="Optional in development"
          />
        </label>
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </form>

      {error ? (
        <p className="text-sm text-amber-200" role="alert">
          {error}
        </p>
      ) : null}

      {data && totals ? (
        <>
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
            <h2 className="text-lg font-semibold">Insights</h2>
            <ul className="mt-3 space-y-2 text-sm text-[var(--muted)]">
              {data.insights.map((insight) => (
                <li key={insight}>• {insight}</li>
              ))}
            </ul>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-5">
              <SparkBars
                label="Articles retrieved (daily)"
                values={data.trends.map((day) => day.articlesRetrieved)}
              />
            </div>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-5">
              <SparkBars
                label="AI calls (daily)"
                values={data.trends.map((day) => day.aiCalls)}
              />
            </div>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-5">
              <SparkBars
                label="Duplicate removals (daily)"
                values={data.trends.map((day) => day.duplicateArticlesRemoved)}
              />
            </div>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-5">
              <SparkBars
                label="Avg generation ms (daily)"
                values={data.trends.map((day) =>
                  Math.round(day.averageBriefingGenerationMs),
                )}
              />
            </div>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-5">
              <SparkBars
                label="API failures (daily)"
                values={data.trends.map((day) => day.apiFailures)}
              />
            </div>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-5">
              <SparkBars
                label="Failed AI requests (daily)"
                values={data.trends.map((day) => day.failedAiRequests)}
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
                      {row.storiesGenerated} stories · {row.briefingCount}{" "}
                      briefing{row.briefingCount === 1 ? "" : "s"}
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
        </>
      ) : null}
    </main>
  );
}
