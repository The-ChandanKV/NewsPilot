"use client";

import { useCallback, useEffect, useState } from "react";
import type { EmailDeliveryRecord } from "@/lib/notifications/subscription-types";
import type { EmailSubscription } from "@/lib/notifications/subscription-types";
import type { UserTopic } from "@/lib/topics/types";

type Props = {
  topics: UserTopic[];
};

export function EmailDeliveryPanel({ topics }: Props) {
  const [subscription, setSubscription] = useState<EmailSubscription | null>(
    null,
  );
  const [deliveries, setDeliveries] = useState<EmailDeliveryRecord[]>([]);
  const [email, setEmail] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [deliveryHour, setDeliveryHour] = useState(6);
  const [deliveryMinute, setDeliveryMinute] = useState(0);
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/email/subscription");
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Failed to load email prefs");
      }
      const sub = (payload.subscription ?? null) as EmailSubscription | null;
      setSubscription(sub);
      setDeliveries((payload.deliveries ?? []) as EmailDeliveryRecord[]);
      if (sub) {
        setEmail(sub.email);
        setTimezone(sub.timezone);
        setDeliveryHour(sub.deliveryHour);
        setDeliveryMinute(sub.deliveryMinute);
        setSelectedTopics(sub.topics.map((item) => item.topic));
      } else {
        setSelectedTopics(topics.map((item) => item.topic));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [topics]);

  useEffect(() => {
    void load();
  }, [load]);

  function toggleTopic(topic: string) {
    setSelectedTopics((prev) =>
      prev.includes(topic)
        ? prev.filter((item) => item !== topic)
        : [...prev, topic],
    );
  }

  async function save() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/email/subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          timezone,
          deliveryHour,
          deliveryMinute,
          topics: selectedTopics,
          active: true,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Failed to save subscription");
      }
      setSubscription(payload.subscription as EmailSubscription);
      setMessage("Email delivery preferences saved.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function unsubscribe() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/email/subscription", {
        method: "DELETE",
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Failed to unsubscribe");
      }
      setSubscription(payload.subscription as EmailSubscription | null);
      setMessage("Unsubscribed from daily briefing emails.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function runDelivery() {
    setSending(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/jobs/email-delivery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ignoreSchedule: true }),
      });
      const payload = await response.json();
      if (!response.ok && payload?.error) {
        throw new Error(payload.error.message ?? "Email delivery failed");
      }
      setMessage(
        `Delivery: ${payload.sent ?? 0} sent, ${payload.failed ?? 0} failed, ${payload.skipped ?? 0} skipped`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            Daily news email
          </h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Sends your stored DailyBriefing — topic, stories, why it matters,
            sources, and what changed. No extra AI generation.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void runDelivery()}
          disabled={sending || loading}
          className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted)] hover:text-[var(--fg)] disabled:opacity-50"
        >
          {sending ? "Sending…" : "Send now"}
        </button>
      </div>

      {loading ? (
        <p className="mt-4 text-sm text-[var(--muted)]">Loading email prefs…</p>
      ) : (
        <div className="mt-4 space-y-3">
          <label className="block text-sm">
            <span className="text-[var(--muted)]">Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2"
              placeholder="you@example.com"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block text-sm">
              <span className="text-[var(--muted)]">Timezone</span>
              <input
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
                className="mt-1 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2"
                placeholder="America/New_York"
              />
            </label>
            <label className="block text-sm">
              <span className="text-[var(--muted)]">Hour</span>
              <input
                type="number"
                min={0}
                max={23}
                value={deliveryHour}
                onChange={(event) =>
                  setDeliveryHour(Number(event.target.value))
                }
                className="mt-1 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2"
              />
            </label>
            <label className="block text-sm">
              <span className="text-[var(--muted)]">Minute</span>
              <input
                type="number"
                min={0}
                max={59}
                value={deliveryMinute}
                onChange={(event) =>
                  setDeliveryMinute(Number(event.target.value))
                }
                className="mt-1 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2"
              />
            </label>
          </div>

          <div>
            <p className="text-sm text-[var(--muted)]">Topics in email</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {topics.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">
                  Save topics first, or leave empty to use all saved topics at
                  send time.
                </p>
              ) : (
                topics.map((topic) => {
                  const checked = selectedTopics.includes(topic.topic);
                  return (
                    <button
                      key={topic.id}
                      type="button"
                      onClick={() => toggleTopic(topic.topic)}
                      className={`rounded-lg border px-3 py-1 text-sm ${
                        checked
                          ? "border-[var(--accent)] text-[var(--fg)]"
                          : "border-[var(--border)] text-[var(--muted)]"
                      }`}
                    >
                      {topic.topic}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || !email.trim()}
              className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm text-black disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save email prefs"}
            </button>
            {subscription?.active ? (
              <button
                type="button"
                onClick={() => void unsubscribe()}
                disabled={saving}
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-amber-200 disabled:opacity-50"
              >
                Unsubscribe
              </button>
            ) : null}
          </div>

          {subscription ? (
            <p className="text-xs text-[var(--muted)]">
              Status: {subscription.active ? "active" : "unsubscribed"} ·{" "}
              {subscription.timezone} at{" "}
              {String(subscription.deliveryHour).padStart(2, "0")}:
              {String(subscription.deliveryMinute).padStart(2, "0")}
            </p>
          ) : null}
        </div>
      )}

      {message ? (
        <p className="mt-3 text-sm text-[var(--muted)]">{message}</p>
      ) : null}
      {error ? (
        <p className="mt-3 text-sm text-amber-200" role="alert">
          {error}
        </p>
      ) : null}

      {deliveries.length > 0 ? (
        <div className="mt-4 border-t border-[var(--border)] pt-4">
          <p className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">
            Recent deliveries
          </p>
          <ul className="mt-2 space-y-1 text-sm text-[var(--muted)]">
            {deliveries.slice(0, 8).map((item) => (
              <li key={item.id}>
                {item.date} · {item.topic} · {item.status}
                {item.attemptCount > 1 ? ` · attempt ${item.attemptCount}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
