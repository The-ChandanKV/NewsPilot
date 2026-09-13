import type { SimilarityDocument, SimilarityProvider } from "@/lib/similarity/types";
import { DeterministicSimilarityProvider } from "@/lib/similarity/deterministic";

/**
 * Optional embedding-backed similarity.
 *
 * Design seam: swap this in via SIMILARITY_PROVIDER=embedding once an embedding
 * backend is configured. Until then it falls back to deterministic scoring so
 * clustering / ranking / briefing code stays unchanged.
 */
export class EmbeddingSimilarityProvider implements SimilarityProvider {
  readonly name = "embedding";
  private fallback = new DeterministicSimilarityProvider();

  /**
   * Placeholder for vector similarity (cosine over embeddings).
   * Not implemented yet — uses deterministic similarity without LLM pair calls.
   */
  async similarity(
    a: SimilarityDocument,
    b: SimilarityDocument,
  ): Promise<number> {
    // Future: embed(a), embed(b), return cosineSimilarity.
    // Intentionally no per-pair LLM calls.
    return this.fallback.similarity(a, b);
  }
}
