"use client";

import { useCallback, useEffect, useState } from "react";
import { MyTopicsPanel } from "@/components/MyTopicsPanel";
import { StoryCard } from "@/components/StoryCard";
import { WhatsNewPanel } from "@/components/WhatsNewPanel";
import type { PersonalizedFeed, UserTopic } from "@/lib/topics/types";
import type { DailyBriefing } from "@/types/briefing";

type ViewMode =
  | { kind: "idle" }
  | { kind: "feed" }
  | { kind: "topic"; topic: UserTopic };

export default function HomePage() {
  const [topics, setTopics] = useState<UserTopic[]>([]);
  const [topicsLoading, setTopicsLoading] = useState(true);
  const [view, setView] = useState<ViewMode>({ kind: "idle" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [briefing, setBriefing] = useState<DailyBriefing | null>(null);
  const [feed, setFeed] = useState<PersonalizedFeed | null>(null);

  const loadTopics = useCallback(async () => {
    setTopicsLoading(true);
    try {
      const response = await fetch("/api/topics");
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Failed to load topics");
      }
      setTopics(payload.topics as UserTopic[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTopicsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTopics();
  }, [loadTopics]);

  async function loadTopicBriefing(topic: UserTopic) {
    setView({ kind: "topic", topic });
    setLoading(true);
    setError(null);
    setFeed(null);
    try {
      const response = await fetch(
        `/api/briefing?topic=${encodeURIComponent(topic.topic)}`,
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Failed to load briefing");
      }
      setBriefing(payload as DailyBriefing);
    } catch (err) {
      setBriefing(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function loadPersonalizedFeed() {
    setView({ kind: "feed" });
    setLoading(true);
    setError(null);
    setBriefing(null);
    try {
      const response = await fetch("/api/feed");
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Failed to load feed");
      }
      setFeed(payload as PersonalizedFeed);
    } catch (err) {
      setFeed(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const selectedTopicId =
    view.kind === "topic" ? view.topic.id : view.kind === "feed" ? "__feed__" : null;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-6 py-16">
      <header className="mb-10">
        <p className="mb-2 text-sm uppercase tracking-[0.2em] text-[var(--muted)]">
          NewsPilot
        </p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          AI News Agent
        </h1>
        <p className="mt-4 max-w-xl text-base leading-relaxed text-[var(--muted)]">
          Save the topics you care about, open a dedicated briefing for any one
          of them, or read a combined personalized feed ranked by relevance and
          your priorities.
        </p>
      </header>

      <MyTopicsPanel
        topics={topics}
        selectedTopicId={
          selectedTopicId === "__feed__" ? null : selectedTopicId
        }
        loading={topicsLoading || loading}
        onSelectTopic={(topic) => {
          void loadTopicBriefing(topic);
        }}
        onSelectFeed={() => {
          void loadPersonalizedFeed();
        }}
        onAdded={(topic) => setTopics((prev) => [...prev, topic])}
        onUpdated={(topic) =>
          setTopics((prev) =>
            prev.map((item) => (item.id === topic.id ? topic : item)),
          )
        }
        onRemoved={(topicId) => {
          setTopics((prev) => prev.filter((item) => item.id !== topicId));
          if (view.kind === "topic" && view.topic.id === topicId) {
            setView({ kind: "idle" });
            setBriefing(null);
          }
        }}
        onReordered={setTopics}
      />

      {error ? (
        <p className="mt-6 text-sm text-amber-200" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="mt-8 text-sm text-[var(--muted)]">Loading stories…</p>
      ) : null}

      {!loading && view.kind === "feed" && feed ? (
        <section className="mt-10 space-y-4">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">
              Personalized feed
            </h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {feed.totalStories} stor
              {feed.totalStories === 1 ? "y" : "ies"} across {feed.topics.length}{" "}
              topic{feed.topics.length === 1 ? "" : "s"} · reused existing
              summaries
              {feed.summaryCacheHits > 0
                ? ` · ${feed.summaryCacheHits} cache hit${feed.summaryCacheHits === 1 ? "" : "s"}`
                : ""}
            </p>
          </div>

          {feed.stories.map((story) => (
            <StoryCard key={`${story.matchedTopicId}-${story.id}`} story={story} />
          ))}

          {feed.stories.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">
              No stories available for your saved topics right now.
            </p>
          ) : null}
        </section>
      ) : null}

      {!loading && view.kind === "topic" && briefing ? (
        <section className="mt-10 space-y-4">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">
              {view.topic.topic}
            </h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {briefing.totalStories} stor
              {briefing.totalStories === 1 ? "y" : "ies"} ·{" "}
              {briefing.timeRange.hours}h window
              {briefing.cached ? " · cached" : ""}
            </p>
          </div>

          {briefing.whatsNew ? (
            <WhatsNewPanel whatsNew={briefing.whatsNew} />
          ) : null}

          {briefing.stories.map((story) => (
            <StoryCard key={story.id} story={story} />
          ))}

          {briefing.stories.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">
              No clustered stories for this topic in the current window.
            </p>
          ) : null}
        </section>
      ) : null}

      {!loading && view.kind === "idle" && topics.length > 0 ? (
        <p className="mt-10 text-sm text-[var(--muted)]">
          Choose a topic above or open your personalized feed.
        </p>
      ) : null}
    </main>
  );
}
