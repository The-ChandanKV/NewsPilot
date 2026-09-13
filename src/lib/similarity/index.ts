import { getEnv } from "@/config/env";
import { DeterministicSimilarityProvider } from "@/lib/similarity/deterministic";
import { EmbeddingSimilarityProvider } from "@/lib/similarity/embeddings";
import type {
  SimilarityProvider,
  SimilarityProviderKind,
} from "@/lib/similarity/types";

export function getSimilarityProvider(
  kind?: SimilarityProviderKind,
): SimilarityProvider {
  const selected = kind ?? getEnv().SIMILARITY_PROVIDER;

  if (selected === "embedding") {
    return new EmbeddingSimilarityProvider();
  }
  return new DeterministicSimilarityProvider();
}

export type {
  SimilarityProvider,
  SimilarityDocument,
  SimilarityProviderKind,
} from "@/lib/similarity/types";
export {
  DeterministicSimilarityProvider,
  normalizeHeadline,
  tokenizeForSimilarity,
  jaccardSimilarity,
  containmentSimilarity,
} from "@/lib/similarity/deterministic";
export { EmbeddingSimilarityProvider } from "@/lib/similarity/embeddings";
