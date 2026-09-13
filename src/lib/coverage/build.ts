import type { DailyBriefingStory } from "@/types/briefing";
import type {
  CoverageComparison,
  CoverageSourceArticle,
} from "@/lib/coverage/types";

const FORBIDDEN_LABEL_PATTERN =
  /\b(left[- ]wing|right[- ]wing|far[- ]left|far[- ]right|the left|the right|liberal media|conservative media|biased|unbiased|\bbias\b|partisan|propaganda)\b/i;

export function collectSourceArticles(
  story: Pick<
    DailyBriefingStory,
    "primarySource" | "relatedSources" | "articleUrls" | "headline" | "coveredBy"
  >,
): CoverageSourceArticle[] {
  const articles: CoverageSourceArticle[] = [];
  const seen = new Set<string>();

  const primaryUrl = story.articleUrls[0];
  if (primaryUrl) {
    articles.push({
      source: story.primarySource || "Primary source",
      title: story.headline,
      url: primaryUrl,
    });
    seen.add(primaryUrl);
  }

  for (const related of story.relatedSources ?? []) {
    if (!related.url || seen.has(related.url)) continue;
    seen.add(related.url);
    articles.push({
      source: related.name || "Source",
      title: related.title || story.headline,
      url: related.url,
    });
  }

  for (const url of story.articleUrls.slice(1)) {
    if (seen.has(url)) continue;
    seen.add(url);
    articles.push({
      source: story.coveredBy?.split("·")[articles.length]?.trim() || "Source",
      title: story.headline,
      url,
    });
  }

  return articles;
}

export function canCompareCoverage(story: DailyBriefingStory): boolean {
  return collectSourceArticles(story).length >= 2;
}

/**
 * Strip / reject political-label phrasing unless the model quoted a source.
 * We never invent left/right/bias classifications.
 */
export function scrubPoliticalLabels(text: string): string {
  if (!FORBIDDEN_LABEL_PATTERN.test(text)) return text;
  // Drop sentences that introduce these labels without an explicit quote attribution.
  return text
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => {
      if (!FORBIDDEN_LABEL_PATTERN.test(sentence)) return true;
      return /\b(says|said|writes|wrote|according to|quoted|reports that)\b/i.test(
        sentence,
      );
    })
    .join(" ")
    .trim();
}

export function scrubComparison(
  comparison: CoverageComparison,
): CoverageComparison {
  const scrubClaim = <T extends { claim: string }>(item: T): T => ({
    ...item,
    claim: scrubPoliticalLabels(item.claim),
  });

  return {
    commonlyReported: comparison.commonlyReported
      .map(scrubClaim)
      .filter((item) => item.claim.length > 0),
    majorityFacts: comparison.majorityFacts
      .map(scrubClaim)
      .filter((item) => item.claim.length > 0),
    sourceReports: comparison.sourceReports.map((report) => ({
      ...report,
      details: report.details
        .map(scrubPoliticalLabels)
        .filter((detail) => detail.length > 0),
    })),
    framingDifferences: comparison.framingDifferences
      .map((item) => ({
        ...item,
        description: scrubPoliticalLabels(item.description),
      }))
      .filter((item) => item.description.length > 0),
    conflictingClaims: comparison.conflictingClaims.map((item) => ({
      ...item,
      issue: scrubPoliticalLabels(item.issue),
      positions: item.positions.map((position) => ({
        ...position,
        claim: scrubPoliticalLabels(position.claim),
      })),
    })),
    missingInformation: comparison.missingInformation
      .map(scrubPoliticalLabels)
      .filter(Boolean),
    unresolved: comparison.unresolved.map(scrubPoliticalLabels).filter(Boolean),
  };
}

/**
 * Deterministic comparison scaffold from stored story fields (no LLM).
 * Used when AI is unavailable or returns invalid JSON.
 */
export function buildDeterministicComparison(
  story: DailyBriefingStory,
  sources: CoverageSourceArticle[],
): CoverageComparison {
  const allUrls = sources.map((s) => s.url);
  const commonlyReported = (story.keyFacts ?? []).slice(0, 6).map((fact) => ({
    claim: fact,
    sources: sources.map((s) => s.source),
    articleUrls: allUrls,
  }));

  const sourceReports = sources.map((source) => ({
    source: source.source,
    url: source.url,
    title: source.title,
    details: [
      `Headline/title on record: ${source.title}`,
      source.source === story.primarySource
        ? `Primary coverage summary: ${story.summary}`
        : `Also covering this event (see article).`,
    ],
  }));

  const conflictingClaims = (story.sourceDisagreements ?? []).map((item) => ({
    issue: item.issue,
    positions: item.positions.map((position) => {
      const match = sources.find(
        (s) => s.source.toLowerCase() === position.source.toLowerCase(),
      );
      return {
        source: position.source,
        claim: position.claim,
        url: match?.url,
      };
    }),
  }));

  const unresolved = [
    ...(story.uncertaintyNotes ?? []),
    ...conflictingClaims.map(
      (item) => `Unresolved disagreement on: ${item.issue}`,
    ),
  ].slice(0, 8);

  return scrubComparison({
    commonlyReported,
    majorityFacts: commonlyReported.slice(0, 4),
    sourceReports,
    framingDifferences: [],
    conflictingClaims,
    missingInformation:
      sources.length < 3
        ? ["Limited outlet set — additional independent sources may add detail."]
        : [],
    unresolved,
  });
}

export function buildCoverageUserPrompt(args: {
  story: DailyBriefingStory;
  sources: CoverageSourceArticle[];
  topic?: string;
}): string {
  const { story, sources, topic } = args;
  const sourceBlock = sources
    .map(
      (source, index) =>
        `[A${index + 1}] source=${source.source}
title=${source.title}
url=${source.url}`,
    )
    .join("\n\n");

  const disagreements =
    story.sourceDisagreements?.length > 0
      ? story.sourceDisagreements
          .map(
            (item) =>
              `- ${item.issue}: ${item.positions
                .map((p) => `${p.source} says "${p.claim}"`)
                .join("; ")}`,
          )
          .join("\n")
      : "(none recorded)";

  return `TOPIC: ${topic ?? "n/a"}
STORY HEADLINE: ${story.headline}
CLUSTER SUMMARY (already multi-source synthesized — use carefully, prefer per-article titles/urls):
${story.summary}
WHY IT MATTERS (optional context, not a verdict): ${story.whyItMatters || "n/a"}
KEY FACTS ON RECORD:
${(story.keyFacts ?? []).map((f) => `- ${f}`).join("\n") || "- (none)"}
ENTITIES: ${(story.entities ?? []).join(", ") || "n/a"}
RECORDED SOURCE DISAGREEMENTS:
${disagreements}
UNCERTAINTY NOTES:
${(story.uncertaintyNotes ?? []).map((n) => `- ${n}`).join("\n") || "- (none)"}

UNDERLYING ARTICLES (${sources.length}):
${sourceBlock}

Return ONLY JSON matching the schema. Attribute every claim to named sources and include article URLs when possible.`;
}

export const COVERAGE_SYSTEM_PROMPT = `You compare how different news outlets report the SAME event.

Hard rules:
1. Compare reporting differences only — agreement, unique details, framing, conflicts, gaps.
2. Do NOT assign political labels such as left, right, biased, unbiased, partisan, or propaganda — unless a source article itself uses that label AND you quote/attribute it explicitly with the article URL. Prefer omitting such labels.
3. Do NOT decide which outlet or political side is "correct" based on writing style.
4. Every factual comparison point must reference underlying articles (source name + URL when available).
5. If evidence is thin, put items under missingInformation or unresolved — do not invent.
6. Use source attribution throughout (e.g. "Reuters reports…", "The Verge notes…").

Return JSON with this shape:
{
  "commonlyReported": [{ "claim": string, "sources": string[], "articleUrls": string[] }],
  "majorityFacts": [{ "claim": string, "sources": string[], "articleUrls": string[] }],
  "sourceReports": [{ "source": string, "url": string, "title": string, "details": string[] }],
  "framingDifferences": [{ "description": string, "sources": string[] }],
  "conflictingClaims": [{ "issue": string, "positions": [{ "source": string, "claim": string, "url": string }] }],
  "missingInformation": string[],
  "unresolved": string[]
}`;
