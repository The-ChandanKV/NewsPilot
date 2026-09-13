import { createHash } from "crypto";
import type { NewsArticleDto, StoryCluster } from "@/types/briefing";

export type SummarizationArticleInput = {
  source: string;
  title: string;
  description: string | null;
  publishedAt: string | null;
  url: string;
};

export type SummarizationClusterInput = {
  topic: string;
  primaryHeadline: string;
  latestPublishedAt: string | null;
  sources: string[];
  sourceCount: number;
  articles: SummarizationArticleInput[];
};

function collectArticles(cluster: StoryCluster): NewsArticleDto[] {
  return [cluster.representativeArticle, ...cluster.relatedArticles];
}

/**
 * Build a minimal, grounded payload for the LLM — no extra commentary.
 * Caps articles per cluster to control tokens.
 */
export function buildSummarizationInput(
  cluster: StoryCluster,
  topic: string,
  maxArticles: number,
): SummarizationClusterInput {
  const articles = collectArticles(cluster)
    .slice(0, maxArticles)
    .map((article) => ({
      source: article.source,
      title: article.title,
      description: article.description,
      publishedAt: article.publishedAt,
      url: article.url,
    }));

  return {
    topic,
    primaryHeadline: cluster.primaryHeadline,
    latestPublishedAt: cluster.latestPublishedAt,
    sources: cluster.sources,
    sourceCount: cluster.sourceCount,
    articles,
  };
}

/**
 * Content hash over material story fields. Same hash ⇒ safe to reuse cached summary.
 */
export function storyContentHash(
  cluster: StoryCluster,
  topic: string,
  maxArticles: number,
): string {
  const input = buildSummarizationInput(cluster, topic, maxArticles);
  const canonical = JSON.stringify({
    topic: input.topic.toLowerCase().trim(),
    articles: input.articles
      .map((article) => ({
        url: article.url,
        title: article.title,
        description: article.description ?? "",
        source: article.source,
        publishedAt: article.publishedAt ?? "",
      }))
      .sort((a, b) => a.url.localeCompare(b.url)),
  });
  return createHash("sha256").update(canonical).digest("hex").slice(0, 24);
}

export const SUMMARIZER_SYSTEM_PROMPT = `You are a careful news desk editor writing neutral briefings.

Rules you MUST follow:
- Use ONLY the provided article titles, descriptions, sources, and dates.
- NEVER invent facts, sources, quotes, numbers, or publication dates.
- NEVER invent causal claims not present in the inputs.
- Distinguish reported facts from inference. Prefer empty inferences.
- Preserve uncertainty. If sources are thin or vague, say so.
- Avoid sensational, emotional, or partisan language.
- Avoid political persuasion. Do not take a political position.
- Do not label political claims as true or false unless the inputs themselves report verified evidence from named sources.
- When credible sources disagree, describe each side's claim with attribution; do not pick a winner.
- Prefer framing like "Source X reports…" over asserting contested claims as fact.
- Allegations must be labeled as allegations/claims, never as established facts.
- Keep the summary factual, calm, and concise (2–5 sentences).
- "Why it matters" must be 1–2 sentences and grounded in the inputs (impact/context only).

Return ONLY valid JSON matching this schema:
{
  "headline": string,
  "summary": string,
  "whyItMatters": string,
  "keyFacts": string[],
  "entities": string[],
  "confidence": "high" | "medium" | "low",
  "uncertaintyNotes": string[],
  "sourceDisagreements": [{ "issue": string, "positions": [{ "source": string, "claim": string }] }],
  "reportedFacts": string[],
  "inferences": string[]
}`;

export function buildSummarizerUserPrompt(input: SummarizationClusterInput): string {
  return [
    "Summarize this single news story cluster.",
    "One response for the whole cluster — do not summarize each article separately.",
    "",
    "STORY_CLUSTER_JSON:",
    JSON.stringify(input),
  ].join("\n");
}
