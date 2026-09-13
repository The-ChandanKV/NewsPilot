import type {
  ResearchCitation,
  ResearchRetrievedStory,
} from "@/lib/research/types";

export const RESEARCH_SYSTEM_PROMPT = `You are NewsPilot's news research assistant.

Rules (strict):
1. Answer ONLY using the RETRIEVED NEWS CONTEXT provided in the user message.
2. Do NOT use outside knowledge, training-data assumptions, or speculation about current events.
3. If the context is insufficient to answer, say so clearly. Do not invent facts, companies, dates, or quotes.
4. Every factual claim must be backed by at least one citation id like [S1].
5. Prefer concise, direct answers. Use short paragraphs or bullets when helpful.
6. When asked about sources or comparisons, use relatedSources, coveredBy, articleUrls, and sourceDisagreements from context.
7. When asked what changed, use changeStatus / changeSummary and any prior-snapshot notes in context.
8. End with a "Sources:" section listing each used citation as: [S1] Title — URL

Return plain text (not JSON). Include clickable raw URLs in the Sources section.`;

export function buildResearchContext(stories: ResearchRetrievedStory[]): string {
  if (stories.length === 0) {
    return "RETRIEVED NEWS CONTEXT: (none)";
  }

  const blocks = stories.map((story) => {
    const urls = story.articleUrls.length
      ? story.articleUrls.map((url, i) => `  - url${i + 1}: ${url}`).join("\n")
      : "  - (no urls)";
    const related = story.relatedSources.length
      ? story.relatedSources
          .map((r) => `  - ${r.name}: ${r.title} (${r.url})`)
          .join("\n")
      : "  - (none listed)";
    const disagreements = story.sourceDisagreements.length
      ? story.sourceDisagreements
          .map(
            (d) =>
              `  - ${d.claim}${d.detail ? ` — ${d.detail}` : ""} [${d.sources.join(", ")}]`,
          )
          .join("\n")
      : "  - (none)";

    return `[${story.citationId}]
topic: ${story.topic}
briefingDate: ${story.briefingDate ?? "n/a"}
headline: ${story.headline}
summary: ${story.summary}
whyItMatters: ${story.whyItMatters || "n/a"}
keyFacts: ${story.keyFacts.join("; ") || "n/a"}
entities: ${story.entities.join("; ") || "n/a"}
primarySource: ${story.primarySource}
coveredBy: ${story.coveredBy}
publishedAt: ${story.publishedAt ?? "n/a"}
changeStatus: ${story.changeStatus ?? "n/a"}
changeSummary: ${story.changeSummary ?? "n/a"}
articleUrls:
${urls}
relatedSources:
${related}
sourceDisagreements:
${disagreements}
origin: ${story.origin}
relevance: ${story.relevanceScore.toFixed(3)}`;
  });

  return `RETRIEVED NEWS CONTEXT (${stories.length} stories):\n\n${blocks.join("\n\n")}`;
}

export function citationsFromStories(
  stories: ResearchRetrievedStory[],
): ResearchCitation[] {
  const citations: ResearchCitation[] = [];
  for (const story of stories) {
    const urls = story.articleUrls.length
      ? story.articleUrls
      : story.relatedSources.map((r) => r.url).filter(Boolean);
    if (urls.length === 0) continue;
    urls.forEach((url, index) => {
      const related = story.relatedSources.find((r) => r.url === url);
      citations.push({
        id: index === 0 ? story.citationId : `${story.citationId}.${index + 1}`,
        label: story.citationId,
        title: related?.title || story.headline,
        url,
        source: related?.name || story.primarySource,
        topic: story.topic,
      });
    });
  }
  return citations;
}

export function parseCitationIdsUsed(answer: string): string[] {
  const matches = answer.matchAll(/\[(S\d+)(?:\.\d+)?\]/g);
  const ids = new Set<string>();
  for (const match of matches) {
    ids.add(match[1]);
  }
  return [...ids];
}
