"use client";

import type { StoryChangeInfo, StoryChangeStatus } from "@/types/briefing";

const STATUS_LABEL: Record<StoryChangeStatus, string> = {
  new: "NEW",
  updated: "UPDATED",
  ongoing: "ONGOING",
};

type Props = {
  change: StoryChangeInfo;
};

export function ChangeBadge({ change }: Props) {
  const tone =
    change.status === "new"
      ? "border-sky-500/40 bg-sky-500/10 text-sky-100"
      : change.status === "updated"
        ? "border-violet-500/40 bg-violet-500/10 text-violet-100"
        : "border-white/15 bg-white/5 text-[var(--muted)]";

  return (
    <div className="space-y-1">
      <span
        className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] font-semibold tracking-wide ${tone}`}
      >
        {STATUS_LABEL[change.status]}
      </span>
      {change.changeSummary ? (
        <p className="text-xs leading-relaxed text-[var(--muted)]">
          {change.changeSummary}
        </p>
      ) : change.status === "ongoing" ? (
        <p className="text-xs text-[var(--muted)]">No material change since last briefing</p>
      ) : null}
    </div>
  );
}
