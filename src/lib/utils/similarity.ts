/**
 * Backward-compatible similarity helpers.
 * Prefer `@/lib/similarity` for new code (pluggable providers).
 */
export {
  normalizeHeadline,
  tokenizeForSimilarity as tokenizeHeadline,
  jaccardSimilarity,
  containmentSimilarity,
} from "@/lib/similarity/deterministic";
import {
  DeterministicSimilarityProvider,
  tokenizeForSimilarity,
} from "@/lib/similarity/deterministic";

const provider = new DeterministicSimilarityProvider();

export function headlineSimilarity(titleA: string, titleB: string): number {
  return provider.similarity({ title: titleA }, { title: titleB });
}

export function textSimilarity(
  titleA: string,
  titleB: string,
  snippetA?: string,
  snippetB?: string,
): number {
  return provider.similarity(
    { title: titleA, snippet: snippetA },
    { title: titleB, snippet: snippetB },
  );
}

export { tokenizeForSimilarity };
