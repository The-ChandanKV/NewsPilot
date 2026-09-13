"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  HistoryLibraryPanel,
  type HistoryLibraryPayload,
} from "@/components/HistoryLibraryPanel";
import { DailyBriefingsPanel } from "@/components/DailyBriefingsPanel";
import { EmailDeliveryPanel } from "@/components/EmailDeliveryPanel";
import { MyTopicsPanel } from "@/components/MyTopicsPanel";
import { PromptInputBox } from "@/components/PromptInputBox";
import { StoryCard } from "@/components/StoryCard";
import { WhatsNewPanel } from "@/components/WhatsNewPanel";
import type { PersonalizedFeed, UserTopic } from "@/lib/topics/types";
import type { DailyBriefing, DailyBriefingStory } from "@/types/briefing";
import type { PersonalizedFeedStory } from "@/lib/topics/types";
import type {
  RecentlyViewedStory,
  SavedStory,
} from "@/lib/history/types";

type ViewMode =
  | { kind: "idle" }
  | { kind: "feed" }
  | { kind: "topic"; topic: string; topicId?: string }
  | { kind: "saved"; story: SavedStory };

export default function HomePage() {
  const [topics, setTopics] = useState<UserTopic[]>([]);
  const [topicsLoading, setTopicsLoading] = useState(true);
  const [view, setView] = useState<ViewMode>({ kind: "idle" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [briefing, setBriefing] = useState<DailyBriefing | null>(null);
  const [feed, setFeed] = useState<PersonalizedFeed | null>(null);
  const [history, setHistory] = useState<HistoryLibraryPayload | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [savedRefIds, setSavedRefIds] = useState<Set<string>>(new Set());
  const [saveBusyId, setSaveBusyId] = useState<string | null>(null);
  const viewedRefs = useRef<Set<string>>(new Set());

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

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const response = await fetch("/api/history");
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Failed to load history");
      }
      const library = payload as HistoryLibraryPayload;
      setHistory(library);
      setSavedRefIds(new Set(library.savedStories.map((s) => s.storyRefId)));
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : String(err));
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTopics();
    void loadHistory();
  }, [loadTopics, loadHistory]);

  async function recordSearch(topic: string, briefing: DailyBriefing) {
    try {
      await fetch("/api/history/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic,
          storyCount: briefing.totalStories,
          briefingAt: briefing.generatedAt,
        }),
      });
      void loadHistory();
    } catch {
      // Non-fatal — briefing still shows.
    }
  }

  async function loadTopicBriefing(topic: string, topicId?: string) {
    setView({ kind: "topic", topic, topicId });
    setLoading(true);
    setError(null);
    setFeed(null);
    try {
      const response = await fetch(
        `/api/briefing?topic=${encodeURIComponent(topic)}`,
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Failed to load briefing");
      }
      const next = payload as DailyBriefing;
      setBriefing(next);
      await recordSearch(topic, next);
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

  async function toggleSave(
    story: DailyBriefingStory | PersonalizedFeedStory,
    topic: string,
  ) {
    const refId = story.id;
    setSaveBusyId(refId);
    try {
      if (savedRefIds.has(refId)) {
        const response = await fetch(
          `/api/saved-stories/${encodeURIComponent(refId)}?byRef=1`,
          { method: "DELETE" },
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error?.message ?? "Failed to unsave story");
        }
        setSavedRefIds((prev) => {
          const next = new Set(prev);
          next.delete(refId);
          return next;
        });
      } else {
        const response = await fetch("/api/saved-stories", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storyRefId: refId,
            headline: story.headline,
            summary: story.summary,
            source: story.primarySource,
            url: story.articleUrls[0] ?? "",
            topic,
          }),
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.error?.message ?? "Failed to save story");
        }
        setSavedRefIds((prev) => new Set(prev).add(refId));
      }
      void loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaveBusyId(null);
    }
  }

  async function markViewed(
    story: DailyBriefingStory | PersonalizedFeedStory,
    topic: string,
  ) {
    if (viewedRefs.current.has(story.id)) return;
    viewedRefs.current.add(story.id);
    try {
      await fetch("/api/history/viewed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storyRefId: story.id,
          headline: story.headline,
          source: story.primarySource,
          url: story.articleUrls[0] ?? "",
          topic,
        }),
      });
    } catch {
      viewedRefs.current.delete(story.id);
    }
  }

  async function clearHistory() {
    setHistoryError(null);
    try {
      const response = await fetch("/api/history", { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Failed to clear history");
      }
      viewedRefs.current.clear();
      await loadHistory();
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : String(err));
    }
  }

  async function unsaveById(savedId: string) {
    try {
      const response = await fetch(`/api/saved-stories/${savedId}`, {
        method: "DELETE",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Failed to unsave story");
      }
      await loadHistory();
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : String(err));
    }
  }

  const selectedTopicId =
    view.kind === "topic"
      ? view.topicId ?? null
      : view.kind === "feed"
        ? "__feed__"
        : null;

  function storyCardProps(
    story: DailyBriefingStory | PersonalizedFeedStory,
    topic: string,
  ) {
    return {
      story,
      topicLabel: topic,
      saved: savedRefIds.has(story.id),
      saveBusy: saveBusyId === story.id,
      onToggleSave: () => {
        void toggleSave(story, topic);
      },
      onView: () => {
        void markViewed(story, topic);
      },
    };
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 px-6 py-16">
      <header>
        <p className="mb-2 text-sm uppercase tracking-[0.2em] text-[var(--muted)]">
          NewsPilot
        </p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          AI News Agent
        </h1>
        <p className="mt-4 max-w-xl text-base leading-relaxed text-[var(--muted)]">
          Save topics and stories, reopen past briefings, and ask research
          questions grounded in your stored news.
        </p>
      </header>

      <PromptInputBox
        onOpenTopic={(topic) => {
          const match = topics.find(
            (item) => item.topic.toLowerCase() === topic.toLowerCase(),
          );
          void loadTopicBriefing(topic, match?.id);
        }}
      />

      <MyTopicsPanel
        topics={topics}
        selectedTopicId={
          selectedTopicId === "__feed__" ? null : selectedTopicId
        }
        loading={topicsLoading || loading}
        onSelectTopic={(topic) => {
          void loadTopicBriefing(topic.topic, topic.id);
        }}
        onSelectFeed={() => {
          void loadPersonalizedFeed();
        }}
        onAdded={(topic) => {
          setTopics((prev) => [...prev, topic]);
          void loadHistory();
        }}
        onUpdated={(topic) =>
          setTopics((prev) =>
            prev.map((item) => (item.id === topic.id ? topic : item)),
          )
        }
        onRemoved={(topicId) => {
          setTopics((prev) => prev.filter((item) => item.id !== topicId));
          void loadHistory();
          if (view.kind === "topic" && view.topicId === topicId) {
            setView({ kind: "idle" });
            setBriefing(null);
          }
        }}
        onReordered={setTopics}
      />

      <HistoryLibraryPanel
        library={history}
        loading={historyLoading}
        error={historyError}
        onRefresh={() => {
          void loadHistory();
        }}
        onClearHistory={() => {
          void clearHistory();
        }}
        onReopenTopic={(topic) => {
          const match = topics.find(
            (item) => item.topic.toLowerCase() === topic.toLowerCase(),
          );
          void loadTopicBriefing(topic, match?.id);
        }}
        onUnsave={(id) => {
          void unsaveById(id);
        }}
        onOpenSaved={(story: SavedStory) => {
          setView({ kind: "saved", story });
          setBriefing(null);
          setFeed(null);
        }}
        onOpenViewed={(story: RecentlyViewedStory) => {
          void loadTopicBriefing(story.topic);
        }}
      />

      <DailyBriefingsPanel
        onOpenTopic={(topic) => {
          const match = topics.find(
            (item) => item.topic.toLowerCase() === topic.toLowerCase(),
          );
          void loadTopicBriefing(topic, match?.id);
        }}
      />

      <EmailDeliveryPanel topics={topics} />

      {error ? (
        <p className="text-sm text-amber-200" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-[var(--muted)]">Loading stories…</p>
      ) : null}

      {!loading && view.kind === "feed" && feed ? (
        <section className="space-y-4">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">
              Personalized feed
            </h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {feed.totalStories} stor
              {feed.totalStories === 1 ? "y" : "ies"} across {feed.topics.length}{" "}
              topic{feed.topics.length === 1 ? "" : "s"}
            </p>
          </div>

          {feed.stories.map((story) => (
            <StoryCard
              key={`${story.matchedTopicId}-${story.id}`}
              {...storyCardProps(story, story.matchedTopic)}
            />
          ))}

          {feed.stories.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">
              No stories available for your saved topics right now.
            </p>
          ) : null}
        </section>
      ) : null}

      {!loading && view.kind === "topic" && briefing ? (
        <section className="space-y-4">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">
              {view.topic}
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
            <StoryCard
              key={story.id}
              {...storyCardProps(story, view.topic)}
            />
          ))}

          {briefing.stories.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">
              No clustered stories for this topic in the current window.
            </p>
          ) : null}
        </section>
      ) : null}

      {!loading && view.kind === "saved" ? (
        <section className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-5">
          <p className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">
            Saved story · {view.story.topic}
          </p>
          <h2 className="text-2xl font-semibold tracking-tight">
            {view.story.headline}
          </h2>
          <p className="text-sm text-[var(--muted)]">{view.story.source}</p>
          <p className="text-sm leading-relaxed">{view.story.summary}</p>
          <div className="flex flex-wrap gap-3 text-sm">
            <a
              href={view.story.url}
              target="_blank"
              rel="noreferrer"
              className="text-[var(--accent)] underline"
            >
              Open source
            </a>
            <button
              type="button"
              className="text-[var(--muted)]"
              onClick={() => void loadTopicBriefing(view.story.topic)}
            >
              Reopen topic briefing
            </button>
            <button
              type="button"
              className="text-amber-200"
              onClick={() => void unsaveById(view.story.id)}
            >
              Unsave
            </button>
          </div>
          <p className="text-xs text-[var(--muted)]">
            Saved {new Date(view.story.savedAt).toLocaleString()}
          </p>
        </section>
      ) : null}

      {!loading && view.kind === "idle" && topics.length > 0 ? (
        <p className="text-sm text-[var(--muted)]">
          Choose a topic above, open your personalized feed, or reopen something
          from history.
        </p>
      ) : null}
    </main>
  );
}
