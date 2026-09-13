"use client";

import type { DailyBriefingStory } from "@/types/briefing";
import type { PersonalizedFeedStory } from "@/lib/topics/types";
import { ChangeBadge } from "@/components/ChangeBadge";
import { VerificationBadge } from "@/components/VerificationBadge";

type Props = {
  story: DailyBriefingStory | PersonalizedFeedStory;
};

function isPersonalized(
  story: DailyBriefingStory | PersonalizedFeedStory,
): story is PersonalizedFeedStory {
  return "matchedTopic" in story && typeof story.matchedTopic === "string";
}

export function StoryCard({ story }: Props) {
  const personalized = isPersonalized(story);

  return (
    <article className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-5 shadow-lg shadow-black/10">
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        {"change" in story && story.change ? (
          <ChangeBadge change={story.change} />
        ) : (
          <span />
        )}
        <VerificationBadge verification={story.verification} />
      </div>

      {personalized ? (
        <p className="mb-2 text-xs uppercase tracking-[0.14em] text-[var(--muted)]">
          {story.matchedTopic}
          {story.alsoInTopics.length > 0
            ? ` · also in ${story.alsoInTopics.join(", ")}`
            : ""}
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
        >
          Read primary source
        </a>
      ) : null}
    </article>
  );
}
