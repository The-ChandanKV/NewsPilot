import type { SimilarityDocument, SimilarityProvider } from "@/lib/similarity/types";

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "with",
  "by",
  "from",
  "as",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "it",
  "its",
  "this",
  "that",
  "these",
  "those",
  "after",
  "over",
  "into",
  "about",
  "says",
  "say",
  "said",
  "today",
  "latest",
  "new",
]);

/** Collapse common news verbs so "launches" ≈ "announces" ≈ "released". */
const VERB_SYNONYMS: Record<string, string> = {
  launch: "release_event",
  launches: "release_event",
  launched: "release_event",
  announce: "release_event",
  announces: "release_event",
  announced: "release_event",
  announcement: "release_event",
  release: "release_event",
  releases: "release_event",
  released: "release_event",
  unveil: "release_event",
  unveils: "release_event",
  unveiled: "release_event",
  introduce: "release_event",
  introduces: "release_event",
  introduced: "release_event",
  debut: "release_event",
  debuts: "release_event",
  roll: "release_event",
  rolls: "release_event",
  rolled: "release_event",
  update: "update_event",
  updates: "update_event",
  updated: "update_event",
};

export function normalizeHeadline(title: string): string {
  return title
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stemToken(token: string): string {
  if (VERB_SYNONYMS[token]) {
    return VERB_SYNONYMS[token];
  }
  // Light plural normalization for nouns (models → model).
  if (token.length > 4 && token.endsWith("s") && !token.endsWith("ss")) {
    return token.slice(0, -1);
  }
  return token;
}

export function tokenizeForSimilarity(text: string): string[] {
  return normalizeHeadline(text)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token))
    .map(stemToken);
}

export function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Fraction of the smaller token set contained in the larger. */
export function containmentSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  const [smaller, larger] =
    setA.size <= setB.size ? [setA, setB] : [setB, setA];
  let hits = 0;
  for (const token of smaller) {
    if (larger.has(token)) hits += 1;
  }
  return hits / smaller.size;
}

function significantTokens(tokens: string[]): string[] {
  // Prefer entity-like / longer tokens for overlap checks.
  return tokens.filter(
    (token) =>
      token.length >= 4 ||
      token === "ai" ||
      token === "openai" ||
      token.endsWith("_event"),
  );
}

/**
 * Deterministic lexical/semantic-lite similarity for news clustering.
 * No LLM / embedding API calls.
 */
export class DeterministicSimilarityProvider implements SimilarityProvider {
  readonly name = "deterministic";

  similarity(a: SimilarityDocument, b: SimilarityDocument): number {
    const titleA = tokenizeForSimilarity(a.normalizedTitle ?? a.title);
    const titleB = tokenizeForSimilarity(b.normalizedTitle ?? b.title);
    const titleJaccard = jaccardSimilarity(titleA, titleB);
    const titleContainment = containmentSimilarity(titleA, titleB);
    const titleScore = Math.max(titleJaccard, titleContainment * 0.92);

    const sigA = significantTokens(titleA);
    const sigB = significantTokens(titleB);
    const entityOverlap =
      sigA.length === 0 || sigB.length === 0
        ? 0
        : containmentSimilarity(sigA, sigB);

    let snippetScore = 0;
    if (a.snippet || b.snippet) {
      const snipA = tokenizeForSimilarity(a.snippet ?? "");
      const snipB = tokenizeForSimilarity(b.snippet ?? "");
      snippetScore = Math.max(
        jaccardSimilarity(snipA, snipB),
        containmentSimilarity(snipA, snipB) * 0.9,
      );
    }

    // Title dominates; snippets and entity overlap reinforce same-event matches.
    const combined =
      titleScore * 0.7 +
      snippetScore * 0.2 +
      entityOverlap * 0.1;

    return Math.min(1, Math.max(0, combined));
  }
}
