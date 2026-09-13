"use client";

import type { StoryVerification } from "@/types/briefing";

type Props = {
  verification: StoryVerification;
};

export function VerificationBadge({ verification }: Props) {
  const isPositive = verification.icon === "check";

  return (
    <div className="space-y-2">
      <div
        className={`inline-flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
          isPositive
            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
            : "border-amber-500/40 bg-amber-500/10 text-amber-100"
        }`}
        title={verification.explanation}
      >
        <span className="mt-0.5 font-semibold" aria-hidden>
          {isPositive ? "✓" : "!"}
        </span>
        <span>
          <span className="font-medium">{verification.label}</span>
          <span className="mt-0.5 block text-xs opacity-90">
            {verification.detail}
          </span>
        </span>
      </div>

      {verification.signals.length > 0 ? (
        <ul className="space-y-1 text-xs text-[var(--muted)]">
          {verification.signals.map((signal) => (
            <li key={signal}>• {signal}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
