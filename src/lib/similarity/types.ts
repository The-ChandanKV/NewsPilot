/**
 * Pluggable article similarity.
 * Deterministic by default; embeddings can be swapped in without touching clustering.
 */
export interface SimilarityProvider {
  readonly name: string;
  /**
   * Return similarity in [0, 1] for two articles.
   * Implementations must be deterministic given the same inputs (or stable embeddings).
   */
  similarity(a: SimilarityDocument, b: SimilarityDocument): number | Promise<number>;
}

export type SimilarityDocument = {
  title: string;
  normalizedTitle?: string;
  snippet?: string;
  sourceName?: string;
};

export type SimilarityProviderKind = "deterministic" | "embedding";
