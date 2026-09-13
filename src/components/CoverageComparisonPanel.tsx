"use client";

import type { ReactNode } from "react";
import type {
  CoverageCompareResult,
  CoverageComparison,
} from "@/lib/coverage/types";

type Props = {
  result: CoverageCompareResult;
  onClose?: () => void;
};

function ClaimList({
  title,
  items,
}: {
  title: string;
  items: Array<{ claim: string; sources: string[]; articleUrls?: string[] }>;
}) {
  if (items.length === 0) return null;
  return (
    <section>
      <h4 className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">
        {title}
      </h4>
      <ul className="mt-2 space-y-2 text-sm">
        {items.map((item) => (
          <li key={`${title}-${item.claim}`}>
            <p>{item.claim}</p>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              Sources: {item.sources.join(" · ")}
              {item.articleUrls && item.articleUrls.length > 0 ? (
                <>
                  {" · "}
                  {item.articleUrls.slice(0, 3).map((url, index) => (
                    <a
                      key={url}
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[var(--accent)] underline underline-offset-2"
                    >
                      article{item.articleUrls!.length > 1 ? ` ${index + 1}` : ""}
                    </a>
                  )).reduce<ReactNode[]>((acc, node, index) => {
                    if (index > 0) acc.push(" · ");
                    acc.push(node);
                    return acc;
                  }, [])}
                </>
              ) : null}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function renderComparison(comparison: CoverageComparison) {
  return (
    <div className="space-y-4">
      <ClaimList title="Commonly reported" items={comparison.commonlyReported} />
      <ClaimList title="Facts mentioned by most sources" items={comparison.majorityFacts} />

      {comparison.sourceReports.length > 0 ? (
        <section>
          <h4 className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">
            Per-source reporting
          </h4>
          <div className="mt-2 space-y-3">
            {comparison.sourceReports.map((report) => (
              <div key={`${report.source}-${report.url ?? report.title}`}>
                <p className="text-sm font-medium">
                  {report.source} reports
                  {report.url ? (
                    <>
                      {" · "}
                      <a
                        href={report.url}
                        target="_blank"
                        rel="noreferrer"
                        className="font-normal text-[var(--accent)] underline underline-offset-2"
                      >
                        {report.title || "Read article"}
                      </a>
                    </>
                  ) : null}
                </p>
                <ul className="mt-1 space-y-1 text-sm text-[var(--muted)]">
                  {report.details.map((detail) => (
                    <li key={detail}>• {detail}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {comparison.framingDifferences.length > 0 ? (
        <section>
          <h4 className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">
            Differences in framing
          </h4>
          <ul className="mt-2 space-y-2 text-sm">
            {comparison.framingDifferences.map((item) => (
              <li key={item.description}>
                <p>{item.description}</p>
                <p className="text-xs text-[var(--muted)]">
                  Sources: {item.sources.join(" · ")}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {comparison.conflictingClaims.length > 0 ? (
        <section>
          <h4 className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">
            Conflicting claims
          </h4>
          <ul className="mt-2 space-y-3 text-sm">
            {comparison.conflictingClaims.map((item) => (
              <li key={item.issue}>
                <p className="font-medium">{item.issue}</p>
                <ul className="mt-1 space-y-1 text-[var(--muted)]">
                  {item.positions.map((position) => (
                    <li key={`${position.source}-${position.claim}`}>
                      {position.source}: {position.claim}
                      {position.url ? (
                        <>
                          {" "}
                          <a
                            href={position.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[var(--accent)] underline underline-offset-2"
                          >
                            source
                          </a>
                        </>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {comparison.missingInformation.length > 0 ? (
        <section>
          <h4 className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">
            Missing information
          </h4>
          <ul className="mt-2 space-y-1 text-sm text-[var(--muted)]">
            {comparison.missingInformation.map((item) => (
              <li key={item}>• {item}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {comparison.unresolved.length > 0 ? (
        <section>
          <h4 className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">
            Unresolved
          </h4>
          <ul className="mt-2 space-y-1 text-sm text-[var(--muted)]">
            {comparison.unresolved.map((item) => (
              <li key={item}>• {item}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export function CoverageComparisonPanel({ result, onClose }: Props) {
  return (
    <div className="mt-4 rounded-xl border border-[var(--border)] bg-black/20 p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">
            Coverage comparison
          </p>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Reporting differences across {result.sourceCount} sources — not a
            political bias score.
            {result.deterministicFallback ? " · structured from stored fields" : ""}
          </p>
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-[var(--muted)] hover:text-[var(--fg)]"
          >
            Close
          </button>
        ) : null}
      </div>

      {result.insufficient ? (
        <p className="text-sm text-amber-200">{result.reason}</p>
      ) : result.comparison ? (
        renderComparison(result.comparison)
      ) : (
        <p className="text-sm text-[var(--muted)]">No comparison available.</p>
      )}

      {result.sources.length > 0 ? (
        <div className="mt-4 border-t border-[var(--border)] pt-3">
          <p className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">
            Underlying articles
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {result.sources.map((source) => (
              <li key={source.url}>
                <a
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[var(--accent)] underline underline-offset-2"
                >
                  {source.source}: {source.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
