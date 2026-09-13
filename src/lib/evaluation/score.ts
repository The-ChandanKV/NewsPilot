import type {
  DimensionScore,
  EvaluationArticle,
  EvaluationCandidate,
  EvaluationCase,
  SummaryEvaluationResult,
  SummaryEvaluationScores,
} from "@/lib/evaluation/types";

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "to",
  "of",
  "in",
  "on",
  "for",
  "with",
  "by",
  "as",
  "at",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "that",
  "this",
  "it",
  "its",
  "from",
  "after",
  "before",
  "into",
  "over",
  "under",
  "not",
  "no",
  "yes",
  "said",
  "says",
  "report",
  "reports",
  "reported",
  "according",
]);

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/[^\p{L}\p{N}\s.$%-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !STOPWORDS.has(token));
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function ratio(hits: number, total: number): number {
  if (total <= 0) return 1;
  return clamp01(hits / total);
}

function sourceCorpus(articles: EvaluationArticle[]): string {
  return articles
    .map(
      (article) =>
        `${article.source} ${article.title} ${article.description ?? ""} ${article.url}`,
    )
    .join(" \n ");
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function extractMoneyAndPercents(text: string): string[] {
  const matches = normalizeText(text).match(/\$?\d[\d,]*(?:\.\d+)?%?|\d+%/g);
  return matches ?? [];
}

function dim(score: number, notes: string[]): DimensionScore {
  return { score: clamp01(score), notes };
}

function candidateText(candidate: EvaluationCandidate): string {
  return [
    candidate.headline,
    candidate.summary,
    candidate.whyItMatters,
    ...candidate.keyFacts,
  ].join(" ");
}

/**
 * Deterministic summary quality scorer (v1).
 * Reproducible for a fixed dataset — not a claim of universal real-world accuracy.
 */
export function scoreSummaryCandidate(
  evaluationCase: EvaluationCase,
  candidate: EvaluationCandidate,
  evaluatedAt = new Date().toISOString(),
): SummaryEvaluationResult {
  const corpus = sourceCorpus(evaluationCase.articles);
  const corpusNorm = normalizeText(corpus);
  const corpusTokens = new Set(tokenize(corpus));
  const text = candidateText(candidate);
  const textNorm = normalizeText(text);
  const textTokens = tokenize(text);
  const notes: SummaryEvaluationScores = {
    factualConsistency: dim(0, []),
    sourceAttribution: dim(0, []),
    completeness: dim(0, []),
    relevance: dim(0, []),
    conciseness: dim(0, []),
    unsupportedClaims: dim(0, []),
    hallucinations: dim(0, []),
  };

  // 1) Factual consistency — fraction of summary content tokens grounded in sources.
  const groundedHits = textTokens.filter((token) => corpusTokens.has(token)).length;
  const factual = ratio(groundedHits, textTokens.length || 1);
  notes.factualConsistency = dim(factual, [
    `${groundedHits}/${textTokens.length || 0} content tokens overlap source corpus`,
  ]);

  // 2) Source attribution — mentions of allowed/source outlet names.
  const sources = unique(
    evaluationCase.articles.map((article) => article.source.trim()),
  );
  const attributed = sources.filter((source) =>
    textNorm.includes(normalizeText(source)),
  );
  const attributionScore =
    sources.length === 0 ? 0 : ratio(attributed.length, Math.min(sources.length, 2));
  notes.sourceAttribution = dim(attributionScore, [
    `Attributed sources mentioned: ${attributed.join(", ") || "none"}`,
  ]);

  // 3) Completeness — required entities/facts present.
  const entityHits = evaluationCase.requiredEntities.filter((entity) =>
    textNorm.includes(normalizeText(entity)),
  );
  const factHits = evaluationCase.requiredFacts.filter((fact) =>
    textNorm.includes(normalizeText(fact)),
  );
  const completeness = clamp01(
    0.5 * ratio(entityHits.length, evaluationCase.requiredEntities.length || 1) +
      0.5 * ratio(factHits.length, evaluationCase.requiredFacts.length || 1),
  );
  notes.completeness = dim(completeness, [
    `Entities ${entityHits.length}/${evaluationCase.requiredEntities.length}`,
    `Facts ${factHits.length}/${evaluationCase.requiredFacts.length}`,
  ]);

  // 4) Relevance — topic + primary headline token overlap.
  const topicTokens = tokenize(evaluationCase.topic);
  const headlineTokens = tokenize(evaluationCase.articles[0]?.title ?? "");
  const relevanceTokens = unique([...topicTokens, ...headlineTokens]);
  const relevanceHits = relevanceTokens.filter((token) =>
    textNorm.includes(token),
  ).length;
  notes.relevance = dim(ratio(relevanceHits, relevanceTokens.length || 1), [
    `${relevanceHits}/${relevanceTokens.length} topic/headline tokens present`,
  ]);

  // 5) Conciseness — prefer ~40–120 words for summary body.
  const summaryWords = wordCount(candidate.summary);
  let conciseness = 1;
  if (summaryWords < 25) conciseness = summaryWords / 25;
  else if (summaryWords > 160) conciseness = clamp01(160 / summaryWords);
  else if (summaryWords > 120) conciseness = 0.85;
  notes.conciseness = dim(conciseness, [`Summary length: ${summaryWords} words`]);

  // 6) Unsupported claims — numeric tokens and keyFacts fragments absent from sources.
  const sourceNumbers = new Set(extractMoneyAndPercents(corpus));
  const summaryNumbers = extractMoneyAndPercents(text);
  const unsupportedNumbers = summaryNumbers.filter(
    (value) => !sourceNumbers.has(value) && !corpusNorm.includes(value),
  );

  const unsupportedFactFragments = candidate.keyFacts.filter((fact) => {
    const tokens = tokenize(fact);
    if (tokens.length === 0) return false;
    const grounded = tokens.filter((token) => corpusTokens.has(token)).length;
    return grounded / tokens.length < 0.34;
  });

  const unsupportedClaimCount =
    unsupportedNumbers.length + unsupportedFactFragments.length;
  const unsupportedScore = clamp01(
    1 -
      unsupportedClaimCount /
        Math.max(2, candidate.keyFacts.length + summaryNumbers.length || 1),
  );
  notes.unsupportedClaims = dim(unsupportedScore, [
    unsupportedClaimCount === 0
      ? "No clear unsupported numbers/keyFacts detected"
      : `Unsupported items: ${[
          ...unsupportedNumbers,
          ...unsupportedFactFragments,
        ]
          .slice(0, 8)
          .join(" | ")}`,
  ]);

  // 7) Hallucinations — invented outlets, severe unsupported load, or absolute claims.
  const inventedSources = [
    "bloomberg",
    "exclusive",
    "unnamed rival",
    "apt-zebra",
    "softbank",
    "sabotage",
    "quantum encryption",
  ].filter((needle) => textNorm.includes(needle) && !corpusNorm.includes(needle));

  const severeUnsupported = unsupportedClaimCount >= 2 || unsupportedNumbers.length >= 1;
  const absoluteClaims =
    /\b(every|proves|permanently destroyed|already breached|largest .+ in history|end all competing)\b/i.test(
      text,
    );

  const hallucinationFlagged =
    inventedSources.length > 0 || severeUnsupported || absoluteClaims;
  const hallucinationScore = hallucinationFlagged
    ? clamp01(0.35 - inventedSources.length * 0.1 - (severeUnsupported ? 0.15 : 0))
    : 0.95;
  notes.hallucinations = dim(hallucinationScore, [
    hallucinationFlagged
      ? `Flagged (${[
          inventedSources.length ? `invented cues: ${inventedSources.join(", ")}` : null,
          severeUnsupported ? "severe unsupported claims" : null,
          absoluteClaims ? "absolute/overconfident claim language" : null,
        ]
          .filter(Boolean)
          .join("; ")})`
      : "No strong hallucination markers detected",
  ]);

  const scores = notes;
  const overallScore = clamp01(
    (scores.factualConsistency.score +
      scores.sourceAttribution.score +
      scores.completeness.score +
      scores.relevance.score +
      scores.conciseness.score +
      scores.unsupportedClaims.score +
      scores.hallucinations.score) /
      7,
  );

  const expectationMatch =
    candidate.expectHallucination === hallucinationFlagged &&
    candidate.expectUnsupported === unsupportedClaimCount > 0;

  return {
    caseId: evaluationCase.id,
    candidateId: candidate.id,
    topic: evaluationCase.topic,
    label: candidate.label,
    scores,
    overallScore,
    summaryWordCount: summaryWords,
    unsupportedClaimCount,
    hallucinationFlagged,
    sourceAttributionScore: scores.sourceAttribution.score,
    expectHallucination: candidate.expectHallucination,
    expectUnsupported: candidate.expectUnsupported,
    expectationMatch,
    evaluatedAt,
  };
}

export function scoreEvaluationCase(
  evaluationCase: EvaluationCase,
  evaluatedAt = new Date().toISOString(),
): SummaryEvaluationResult[] {
  return evaluationCase.candidates.map((candidate) =>
    scoreSummaryCandidate(evaluationCase, candidate, evaluatedAt),
  );
}
