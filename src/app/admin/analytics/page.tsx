"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { PipelineAnalyticsDashboard } from "@/components/admin/PipelineAnalyticsDashboard";
import type { PipelineAnalyticsSnapshot } from "@/lib/analytics/types";

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
            failures — plus live development metrics for AI calls, cache hits,
            and processing time under limited Gemini/Claude quota. Calculations
            run server-side; this page only renders results. No API keys or
            personal data are shown.
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

      {data ? <PipelineAnalyticsDashboard data={data} /> : null}
    </main>
  );
}
