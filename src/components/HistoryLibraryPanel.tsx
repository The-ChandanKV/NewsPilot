"use client";

import type { ReactNode } from "react";
import type {
  RecentlyViewedStory,
  SavedStory,
  SearchHistoryEntry,
} from "@/lib/history/types";
import type { UserTopic } from "@/lib/topics/types";

export type HistoryLibraryPayload = {
  recentSearches: SearchHistoryEntry[];
  searchHistory: SearchHistoryEntry[];
  savedStories: SavedStory[];
  recentlyViewed: RecentlyViewedStory[];
  savedTopics: UserTopic[];
};

type Props = {
  library: HistoryLibraryPayload | null;
  loading?: boolean;
  error?: string | null;
  onRefresh: () => void;
  onClearHistory: () => void;
  onReopenTopic: (topic: string) => void;
  onUnsave: (savedId: string) => void;
  onOpenSaved: (story: SavedStory) => void;
  onOpenViewed: (story: RecentlyViewedStory) => void;
};

function EmptyLine({ children }: { children: ReactNode }) {
  return <p className="text-sm text-[var(--muted)]">{children}</p>;
}

export function HistoryLibraryPanel({
  library,
  loading,
  error,
  onRefresh,
  onClearHistory,
  onReopenTopic,
  onUnsave,
  onOpenSaved,
  onOpenViewed,
}: Props) {
  const hasSearches = (library?.searchHistory.length ?? 0) > 0;
  const hasSaved = (library?.savedStories.length ?? 0) > 0;
  const hasViewed = (library?.recentlyViewed.length ?? 0) > 0;
  const hasTopics = (library?.savedTopics.length ?? 0) > 0;
  const isEmpty =
    library && !hasSearches && !hasSaved && !hasViewed && !hasTopics;

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            History & saved
          </h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Recent searches, bookmarks, and previously opened stories.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--muted)] transition hover:bg-white/5 disabled:opacity-50"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={onClearHistory}
            disabled={loading || (!hasSearches && !hasViewed)}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-amber-200 transition hover:bg-white/5 disabled:opacity-50"
          >
            Clear history
          </button>
        </div>
      </div>

      {error ? (
        <p className="mt-3 text-sm text-amber-200" role="alert">
          {error}
        </p>
      ) : null}

      {loading && !library ? (
        <p className="mt-4 text-sm text-[var(--muted)]">Loading history…</p>
      ) : null}

      {isEmpty ? (
        <div className="mt-4 space-y-1">
          <EmptyLine>No history yet.</EmptyLine>
          <EmptyLine>
            Open a topic briefing or save a story to populate this panel.
          </EmptyLine>
        </div>
      ) : null}

      {library ? (
        <div className="mt-5 space-y-6">
          <section>
            <h3 className="text-sm font-medium text-foreground/90">
              Recent searches
            </h3>
            {library.recentSearches.length === 0 ? (
              <div className="mt-2">
                <EmptyLine>No recent searches.</EmptyLine>
              </div>
            ) : (
              <ul className="mt-2 flex flex-wrap gap-2">
                {library.recentSearches.map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      onClick={() => onReopenTopic(entry.topic)}
                      className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs transition hover:bg-white/5"
                      title="Reopen briefing"
                    >
                      {entry.topic}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3 className="text-sm font-medium text-foreground/90">
              Search history
            </h3>
            {library.searchHistory.length === 0 ? (
              <div className="mt-2">
                <EmptyLine>Search history is empty.</EmptyLine>
              </div>
            ) : (
              <ul className="mt-2 space-y-2">
                {library.searchHistory.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] px-3 py-2"
                  >
                    <div>
                      <button
                        type="button"
                        onClick={() => onReopenTopic(entry.topic)}
                        className="text-sm font-medium hover:underline"
                      >
                        {entry.topic}
                      </button>
                      <p className="text-xs text-[var(--muted)]">
                        {entry.storyCount} stor
                        {entry.storyCount === 1 ? "y" : "ies"}
                        {entry.lastBriefingAt
                          ? ` · last opened ${new Date(entry.lastBriefingAt).toLocaleString()}`
                          : ""}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onReopenTopic(entry.topic)}
                      className="text-xs text-[var(--accent)]"
                    >
                      Reopen briefing
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3 className="text-sm font-medium text-foreground/90">
              Saved topics
            </h3>
            {library.savedTopics.length === 0 ? (
              <div className="mt-2">
                <EmptyLine>
                  No saved topics yet — add some in My Topics.
                </EmptyLine>
              </div>
            ) : (
              <ul className="mt-2 flex flex-wrap gap-2">
                {library.savedTopics.map((topic) => (
                  <li key={topic.id}>
                    <button
                      type="button"
                      onClick={() => onReopenTopic(topic.topic)}
                      className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs transition hover:bg-white/5"
                    >
                      {topic.topic}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3 className="text-sm font-medium text-foreground/90">
              Saved stories
            </h3>
            {library.savedStories.length === 0 ? (
              <div className="mt-2">
                <EmptyLine>No saved stories yet.</EmptyLine>
              </div>
            ) : (
              <ul className="mt-2 space-y-2">
                {library.savedStories.map((story) => (
                  <li
                    key={story.id}
                    className="rounded-lg border border-[var(--border)] px-3 py-2"
                  >
                    <button
                      type="button"
                      onClick={() => onOpenSaved(story)}
                      className="text-left text-sm font-medium hover:underline"
                    >
                      {story.headline}
                    </button>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      {story.source} · {story.topic} · saved{" "}
                      {new Date(story.savedAt).toLocaleString()}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-3 text-xs">
                      <a
                        href={story.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[var(--accent)] underline"
                      >
                        Open source
                      </a>
                      <button
                        type="button"
                        onClick={() => onUnsave(story.id)}
                        className="text-amber-200"
                      >
                        Unsave
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3 className="text-sm font-medium text-foreground/90">
              Recently viewed
            </h3>
            {library.recentlyViewed.length === 0 ? (
              <div className="mt-2">
                <EmptyLine>No recently viewed stories.</EmptyLine>
              </div>
            ) : (
              <ul className="mt-2 space-y-2">
                {library.recentlyViewed.map((story) => (
                  <li
                    key={story.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] px-3 py-2"
                  >
                    <div>
                      <button
                        type="button"
                        onClick={() => onOpenViewed(story)}
                        className="text-left text-sm font-medium hover:underline"
                      >
                        {story.headline}
                      </button>
                      <p className="text-xs text-[var(--muted)]">
                        {story.source} · {story.topic}
                      </p>
                    </div>
                    <a
                      href={story.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-[var(--accent)] underline"
                    >
                      Source
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : null}
    </section>
  );
}
