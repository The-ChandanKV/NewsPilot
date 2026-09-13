"use client";

import { useCallback, useEffect, useState } from "react";
import type { StoredDailyBriefing } from "@/lib/jobs/types";

type Schedule = {
  hour: number;
  minute: number;
  timeZone: string;
  frequencies: string[];
};

type Props = {
  onOpenTopic?: (topic: string) => void;
};

function formatDateHeading(date: string): string {
  const parsed = Date.parse(`${date}T12:00:00.000Z`);
  if (Number.isNaN(parsed)) return date;
  return new Date(parsed).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function DailyBriefingsPanel({ onOpenTopic }: Props) {
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [briefings, setBriefings] = useState<StoredDailyBriefing[]>([]);
  const [selected, setSelected] = useState<StoredDailyBriefing | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobMessage, setJobMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/jobs/daily-briefings");
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Failed to load daily briefings");
      }
      setSchedule(payload.schedule as Schedule);
      const list = (payload.briefings ?? []) as StoredDailyBriefing[];
      setBriefings(list);
      setDate(list[0]?.date ?? null);
      if (list[0]) setSelected(list[0]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function runJob() {
    setRunning(true);
    setJobMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/jobs/daily-briefings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = await response.json();
      if (!response.ok && payload?.error) {
        throw new Error(payload.error.message ?? "Daily job failed");
      }
      setJobMessage(
        `Job ${payload.status}: ${payload.topicsCreated ?? 0} created, ${payload.topicsSkipped ?? 0} skipped, ${payload.topicsFailed ?? 0} failed`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            Automatic daily briefings
          </h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Generated for subscribed topics
            {schedule
              ? ` at ${String(schedule.hour).padStart(2, "0")}:${String(schedule.minute).padStart(2, "0")} ${schedule.timeZone}`
              : ""}
            . Unchanged stories reuse cached summaries.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading || running}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--muted)] transition hover:bg-white/5 disabled:opacity-50"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={() => void runJob()}
            disabled={loading || running}
            className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white transition hover:brightness-110 disabled:opacity-50"
          >
            {running ? "Running…" : "Run daily job"}
          </button>
        </div>
      </div>

      {error ? (
        <p className="mt-3 text-sm text-amber-200" role="alert">
          {error}
        </p>
      ) : null}
      {jobMessage ? (
        <p className="mt-3 text-sm text-[var(--muted)]">{jobMessage}</p>
      ) : null}

      {loading ? (
        <p className="mt-4 text-sm text-[var(--muted)]">Loading daily briefings…</p>
      ) : null}

      {!loading && briefings.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--muted)]">
          No stored daily briefings yet. Subscribe topics with a daily frequency,
          then run the job (or wait for cron:{" "}
          <code className="text-xs">npm run job:daily-briefings</code>).
        </p>
      ) : null}

      {!loading && briefings.length > 0 ? (
        <div className="mt-5 grid gap-4 md:grid-cols-[12rem_1fr]">
          <ul className="space-y-2">
            {briefings.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setSelected(item)}
                  className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${
                    selected?.id === item.id
                      ? "border-[var(--accent)] bg-[var(--accent)]/10"
                      : "border-[var(--border)] hover:bg-white/5"
                  }`}
                >
                  <span className="font-medium">{item.topic}</span>
                  <span className="mt-1 block text-xs text-[var(--muted)]">
                    {item.date}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {selected ? (
            <article className="rounded-xl border border-[var(--border)] p-4">
              <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">
                {selected.topic} daily briefing
              </p>
              <h3 className="mt-2 text-xl font-semibold tracking-tight">
                {formatDateHeading(selected.date)}
              </h3>

              <div className="mt-4">
                <h4 className="text-sm font-medium">Top developments</h4>
                {selected.topDevelopments.length === 0 ? (
                  <p className="mt-2 text-sm text-[var(--muted)]">
                    No developments stored for this day.
                  </p>
                ) : (
                  <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
                    {selected.topDevelopments.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ol>
                )}
              </div>

              <div className="mt-4">
                <h4 className="text-sm font-medium">What&apos;s new</h4>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  {selected.changes.label}: {selected.changes.newCount} new ·{" "}
                  {selected.changes.updatedCount} updated ·{" "}
                  {selected.changes.ongoingCount} ongoing
                </p>
                {selected.changes.highlights.length > 0 ? (
                  <ul className="mt-2 space-y-1 text-sm text-[var(--muted)]">
                    {selected.changes.highlights.map((item) => (
                      <li key={`${item.status}-${item.headline}`}>
                        <span className="uppercase tracking-wide">
                          {item.status}
                        </span>{" "}
                        — {item.headline}
                        {item.changeSummary ? ` (${item.changeSummary})` : ""}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>

              <div className="mt-4">
                <h4 className="text-sm font-medium">Why it matters</h4>
                {selected.whyItMatters.length === 0 ? (
                  <p className="mt-2 text-sm text-[var(--muted)]">
                    No why-it-matters notes for this briefing.
                  </p>
                ) : (
                  <ul className="mt-2 space-y-1 text-sm text-[var(--muted)]">
                    {selected.whyItMatters.map((item) => (
                      <li key={item}>• {item}</li>
                    ))}
                  </ul>
                )}
              </div>

              <p className="mt-4 text-xs text-[var(--muted)]">
                Stats: {selected.generationStats.articlesRetrieved} articles ·{" "}
                {selected.generationStats.duplicateArticlesRemoved} duplicates
                removed · {selected.generationStats.storyClustersCreated}{" "}
                clusters · {selected.generationStats.aiCalls} AI calls ·{" "}
                {selected.generationStats.cachedSummaries} cached ·{" "}
                {selected.generationStats.generationDurationMs}ms
              </p>

              {onOpenTopic ? (
                <button
                  type="button"
                  className="mt-3 text-sm text-[var(--accent)] underline"
                  onClick={() => onOpenTopic(selected.topic)}
                >
                  Open live topic briefing
                </button>
              ) : null}
            </article>
          ) : null}
        </div>
      ) : null}

      {date ? (
        <p className="mt-3 text-xs text-[var(--muted)]">Showing {date}</p>
      ) : null}
    </section>
  );
}
