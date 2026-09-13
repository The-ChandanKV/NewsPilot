"use client";

import { useState } from "react";
import type { DailyBriefingStory } from "@/types/briefing";
import type { PersonalizedFeedStory } from "@/lib/topics/types";
import { ChangeBadge } from "@/components/ChangeBadge";
import { CoverageComparisonPanel } from "@/components/CoverageComparisonPanel";
import { VerificationBadge } from "@/components/VerificationBadge";
import { canCompareCoverage } from "@/lib/coverage/build";
import type { CoverageCompareResult } from "@/lib/coverage/types";

type Props = {
  story: DailyBriefingStory | PersonalizedFeedStory;
  topicLabel?: string;
  saved?: boolean;
  onToggleSave?: () => void;
  onView?: () => void;
  saveBusy?: boolean;
};

function isPersonalized(
  story: DailyBriefingStory | PersonalizedFeedStory,
): story is PersonalizedFeedStory {
  return "matchedTopic" in story && typeof story.matchedTopic === "string";
}

export function StoryCard({
  story,
  topicLabel,
  saved,
  onToggleSave,
  onView,
  saveBusy,
}: Props) {
  const personalized = isPersonalized(story);
  const topic =
    topicLabel ||
    (personalized ? story.matchedTopic : undefined);
  const comparable = canCompareCoverage(story);
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [comparison, setComparison] = useState<CoverageCompareResult | null>(
    null,
  );

  async function runCompare() {
    if (compareOpen && comparison) {
      setCompareOpen(false);
      return;
    }
    setCompareOpen(true);
    if (comparison) return;

    setCompareLoading(true);
    setCompareError(null);
    try {
      const response = await fetch("/api/coverage/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ story, topic }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Coverage compare failed");
      }
      setComparison(payload as CoverageCompareResult);
    } catch (err) {
      setCompareError(err instanceof Error ? err.message : String(err));
    } finally {
      setCompareLoading(false);
    }
  }

  return (
    <article
      className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-5 shadow-lg shadow-black/10"
      onMouseEnter={() => onView?.()}
      onFocus={() => onView?.()}
    >
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        {"change" in story && story.change ? (
          <ChangeBadge change={story.change} />
        ) : (
          <span />
        )}
        <div className="flex flex-wrap items-start gap-2">
          {onToggleSave ? (
            <button
              type="button"
              onClick={onToggleSave}
              disabled={saveBusy}
              className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs transition hover:bg-white/5 disabled:opacity-50"
              aria-pressed={saved}
            >
              {saved ? "Saved" : "Save"}
            </button>
          ) : null}
          {comparable ? (
            <button
              type="button"
              onClick={() => void runCompare()}
              disabled={compareLoading}
              className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs transition hover:bg-white/5 disabled:opacity-50"
              aria-expanded={compareOpen}
            >
              {compareLoading
                ? "Comparing…"
                : compareOpen
                  ? "Hide comparison"
                  : "Compare coverage"}
            </button>
          ) : null}
          <VerificationBadge verification={story.verification} />
        </div>
      </div>

      {personalized ? (
        <p className="mb-2 text-xs uppercase tracking-[0.14em] text-[var(--muted)]">
          {story.matchedTopic}
          {story.alsoInTopics.length > 0
            ? ` · also in ${story.alsoInTopics.join(", ")}`
            : ""}
        </p>
      ) : topic ? (
        <p className="mb-2 text-xs uppercase tracking-[0.14em] text-[var(--muted)]">
          {topic}
        </p>
      ) : null}

      <h2 className="text-xl font-semibold tracking-tight text-foreground">
        {story.headline}
      </h2>

      <p className="mt-2 text-sm text-[var(--muted)]">
        Covered by: {story.coveredBy || story.primarySource}
      </p>

      <p className="mt-4 text-sm leading-relaxed text-foreground/90">
        {story.summary}
      </p>

      {story.whyItMatters ? (
        <p className="mt-3 text-sm text-[var(--muted)]">
          <span className="font-medium text-foreground/80">Why it matters: </span>
          {story.whyItMatters}
        </p>
      ) : null}

      {story.keyFacts.length > 0 ? (
        <ul className="mt-4 space-y-1 text-sm text-[var(--muted)]">
          {story.keyFacts.slice(0, 5).map((fact) => (
            <li key={fact}>• {fact}</li>
          ))}
        </ul>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-3 text-xs text-[var(--muted)]">
        {story.publishedAt ? (
          <span>{new Date(story.publishedAt).toLocaleString()}</span>
        ) : null}
        <span>Primary: {story.primarySource}</span>
        {personalized ? (
          <span className="rounded bg-white/5 px-2 py-0.5">
            Score {story.personalScore.toFixed(2)}
          </span>
        ) : null}
        {story.isAiGenerated ? (
          <span className="rounded bg-white/5 px-2 py-0.5">AI summary</span>
        ) : (
          <span className="rounded bg-white/5 px-2 py-0.5">Source extract</span>
        )}
      </div>

      {story.articleUrls[0] ? (
        <a
          href={story.articleUrls[0]}
          target="_blank"
          rel="noreferrer"
          className="mt-4 inline-block text-sm text-[var(--accent)] underline"
          onClick={() => onView?.()}
        >
          Read primary source
        </a>
      ) : null}

      {compareError ? (
        <p className="mt-3 text-sm text-amber-200" role="alert">
          {compareError}
        </p>
      ) : null}

      {compareOpen && comparison ? (
        <CoverageComparisonPanel
          result={comparison}
          onClose={() => setCompareOpen(false)}
        />
      ) : null}
    </article>
  );
}
