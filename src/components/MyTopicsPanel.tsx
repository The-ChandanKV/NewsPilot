"use client";

import { FormEvent, useState } from "react";
import {
  TOPIC_FREQUENCIES,
  frequencyLabel,
  type TopicFrequency,
  type UserTopic,
} from "@/lib/topics/types";

type Props = {
  topics: UserTopic[];
  selectedTopicId: string | null;
  loading?: boolean;
  onSelectTopic: (topic: UserTopic) => void;
  onSelectFeed: () => void;
  onAdded: (topic: UserTopic) => void;
  onUpdated: (topic: UserTopic) => void;
  onRemoved: (topicId: string) => void;
  onReordered: (topics: UserTopic[]) => void;
};

const SUGGESTIONS = [
  "Artificial Intelligence",
  "Cybersecurity",
  "Indian Technology",
  "Startups",
  "Space",
];

export function MyTopicsPanel({
  topics,
  selectedTopicId,
  loading,
  onSelectTopic,
  onSelectFeed,
  onAdded,
  onUpdated,
  onRemoved,
  onReordered,
}: Props) {
  const [draft, setDraft] = useState("");
  const [frequency, setFrequency] = useState<TopicFrequency>("daily");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  async function addTopic(topic: string) {
    const trimmed = topic.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/topics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: trimmed, frequency }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Failed to add topic");
      }
      onAdded(payload.topic as UserTopic);
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleAdd(event: FormEvent) {
    event.preventDefault();
    await addTopic(draft);
  }

  async function handleRemove(id: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/topics/${id}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Failed to remove topic");
      }
      onRemoved(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleRename(id: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/topics/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: editName }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Failed to rename topic");
      }
      onUpdated(payload.topic as UserTopic);
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleFrequency(id: string, next: TopicFrequency) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/topics/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frequency: next }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Failed to update frequency");
      }
      onUpdated(payload.topic as UserTopic);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function move(id: string, direction: -1 | 1) {
    const index = topics.findIndex((topic) => topic.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= topics.length) return;

    const ordered = [...topics];
    const [item] = ordered.splice(index, 1);
    ordered.splice(target, 0, item);

    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/topics", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedIds: ordered.map((topic) => topic.id) }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Failed to reorder topics");
      }
      onReordered(payload.topics as UserTopic[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const disabled = busy || loading;

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">My Topics</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Priority follows list order. Click a topic for its briefing, or open
            your combined feed.
          </p>
        </div>
        <button
          type="button"
          onClick={onSelectFeed}
          disabled={topics.length === 0 || disabled}
          className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition hover:brightness-110 disabled:opacity-50"
        >
          Personalized feed
        </button>
      </div>

      <form onSubmit={handleAdd} className="mt-4 flex flex-col gap-3 sm:flex-row">
        <input
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Add a topic…"
          className="flex-1 rounded-xl border border-[var(--border)] bg-[#0f1419] px-4 py-2.5 text-sm outline-none ring-[var(--accent)] placeholder:text-[var(--muted)] focus:ring-2"
          disabled={disabled}
        />
        <select
          value={frequency}
          onChange={(event) => setFrequency(event.target.value as TopicFrequency)}
          className="rounded-xl border border-[var(--border)] bg-[#0f1419] px-3 py-2.5 text-sm"
          disabled={disabled}
          aria-label="Preferred frequency"
        >
          {TOPIC_FREQUENCIES.map((value) => (
            <option key={value} value={value}>
              {frequencyLabel(value)}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={disabled || !draft.trim()}
          className="rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm font-medium transition hover:bg-white/5 disabled:opacity-50"
        >
          Add
        </button>
      </form>

      {topics.length === 0 ? (
        <div className="mt-4">
          <p className="text-sm text-[var(--muted)]">Suggestions</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                disabled={disabled}
                onClick={() => addTopic(suggestion)}
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--muted)] transition hover:bg-white/5 hover:text-foreground disabled:opacity-50"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <ul className="mt-5 space-y-2">
        {topics.map((topic, index) => (
          <li
            key={topic.id}
            className={`rounded-xl border px-3 py-3 ${
              selectedTopicId === topic.id
                ? "border-[var(--accent)] bg-[var(--accent)]/10"
                : "border-[var(--border)]"
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                {editingId === topic.id ? (
                  <div className="flex flex-wrap gap-2">
                    <input
                      value={editName}
                      onChange={(event) => setEditName(event.target.value)}
                      className="min-w-[12rem] flex-1 rounded-lg border border-[var(--border)] bg-[#0f1419] px-3 py-1.5 text-sm"
                    />
                    <button
                      type="button"
                      className="text-sm text-[var(--accent)]"
                      onClick={() => handleRename(topic.id)}
                      disabled={disabled}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="text-sm text-[var(--muted)]"
                      onClick={() => setEditingId(null)}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => onSelectTopic(topic)}
                    className="text-left text-sm font-medium hover:underline"
                  >
                    <span className="mr-2 text-xs text-[var(--muted)]">
                      #{index + 1}
                    </span>
                    {topic.topic}
                  </button>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <label className="text-xs text-[var(--muted)]">
                    Frequency
                    <select
                      className="ml-2 rounded-md border border-[var(--border)] bg-[#0f1419] px-2 py-1 text-xs"
                      value={topic.frequency}
                      disabled={disabled}
                      onChange={(event) =>
                        handleFrequency(
                          topic.id,
                          event.target.value as TopicFrequency,
                        )
                      }
                    >
                      {TOPIC_FREQUENCIES.map((value) => (
                        <option key={value} value={value}>
                          {frequencyLabel(value)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>

              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  className="rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted)] disabled:opacity-40"
                  disabled={disabled || index === 0}
                  onClick={() => move(topic.id, -1)}
                  aria-label="Move up"
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted)] disabled:opacity-40"
                  disabled={disabled || index === topics.length - 1}
                  onClick={() => move(topic.id, 1)}
                  aria-label="Move down"
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted)]"
                  disabled={disabled}
                  onClick={() => {
                    setEditingId(topic.id);
                    setEditName(topic.topic);
                  }}
                >
                  Rename
                </button>
                <button
                  type="button"
                  className="rounded-md border border-[var(--border)] px-2 py-1 text-xs text-amber-200"
                  disabled={disabled}
                  onClick={() => handleRemove(topic.id)}
                >
                  Remove
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {error ? (
        <p className="mt-3 text-sm text-amber-200" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
