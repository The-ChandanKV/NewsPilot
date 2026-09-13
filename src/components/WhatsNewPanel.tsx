"use client";

import type { WhatsNewSummary } from "@/types/briefing";

type Props = {
  whatsNew: WhatsNewSummary;
};

export function WhatsNewPanel({ whatsNew }: Props) {
  const hasBaseline = Boolean(whatsNew.comparedToGeneratedAt);
  const hasHighlights = whatsNew.highlights.length > 0;

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-5">
      <h2 className="text-lg font-semibold tracking-tight">{whatsNew.label}</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">
        {whatsNew.newCount} new · {whatsNew.updatedCount} updated ·{" "}
        {whatsNew.ongoingCount} ongoing
      </p>

      {!hasBaseline ? (
        <p className="mt-3 text-sm text-[var(--muted)]">
          No prior briefing for this topic yet — all stories are marked new.
        </p>
      ) : null}

      {hasHighlights ? (
        <ul className="mt-4 space-y-3">
          {whatsNew.highlights.map((item) => (
            <li key={`${item.status}-${item.headline}`} className="text-sm">
              <span className="mr-2 text-[11px] font-semibold tracking-wide text-[var(--muted)]">
                {item.status === "new" ? "NEW" : "UPDATED"}
              </span>
              <span className="font-medium text-foreground/90">{item.headline}</span>
              {item.changeSummary ? (
                <p className="mt-1 text-xs text-[var(--muted)]">{item.changeSummary}</p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : hasBaseline ? (
        <p className="mt-3 text-sm text-[var(--muted)]">
          No new or updated stories since the last briefing.
        </p>
      ) : null}
    </section>
  );
}
