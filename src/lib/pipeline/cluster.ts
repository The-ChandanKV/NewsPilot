import { getScoringConfig } from "@/config/scoring";
import type { NormalizedArticle } from "@/lib/pipeline/normalize";
import {
  getSimilarityProvider,
  type SimilarityProvider,
} from "@/lib/similarity";

class UnionFind {
  private parent: number[];
  private rank: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
    this.rank = Array.from({ length: size }, () => 0);
  }

  find(i: number): number {
    if (this.parent[i] !== i) {
      this.parent[i] = this.find(this.parent[i]);
    }
    return this.parent[i];
  }

  union(a: number, b: number): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) return;

    if (this.rank[rootA] < this.rank[rootB]) {
      this.parent[rootA] = rootB;
    } else if (this.rank[rootA] > this.rank[rootB]) {
      this.parent[rootB] = rootA;
    } else {
      this.parent[rootB] = rootA;
      this.rank[rootA] += 1;
    }
  }
}

export type ArticleClusterGroup = {
  articles: NormalizedArticle[];
  /** Mean pairwise similarity within the cluster (1 for singletons). */
  similarityScore: number;
};

async function resolveSimilarity(
  provider: SimilarityProvider,
  a: NormalizedArticle,
  b: NormalizedArticle,
): Promise<number> {
  const score = provider.similarity(
    {
      title: a.title,
      normalizedTitle: a.normalizedTitle,
      snippet: a.snippet,
      sourceName: a.sourceName,
    },
    {
      title: b.title,
      normalizedTitle: b.normalizedTitle,
      snippet: b.snippet,
      sourceName: b.sourceName,
    },
  );
  return await Promise.resolve(score);
}

/**
 * Group related articles into story/event clusters.
 * Deterministic by default — no LLM pair comparisons.
 */
export async function clusterRelatedStories(
  articles: NormalizedArticle[],
  options?: {
    threshold?: number;
    similarity?: SimilarityProvider;
  },
): Promise<ArticleClusterGroup[]> {
  if (articles.length === 0) {
    return [];
  }

  const config = getScoringConfig();
  const cutoff = options?.threshold ?? config.STORY_CLUSTER_SIMILARITY_THRESHOLD;
  const similarity = options?.similarity ?? getSimilarityProvider();
  const uf = new UnionFind(articles.length);
  const pairScores = new Map<string, number>();

  for (let i = 0; i < articles.length; i += 1) {
    for (let j = i + 1; j < articles.length; j += 1) {
      const score = await resolveSimilarity(similarity, articles[i], articles[j]);
      pairScores.set(`${i}:${j}`, score);
      if (score >= cutoff) {
        uf.union(i, j);
      }
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < articles.length; i += 1) {
    const root = uf.find(i);
    const list = groups.get(root) ?? [];
    list.push(i);
    groups.set(root, list);
  }

  return [...groups.values()].map((indexes) => {
    const members = indexes.map((index) => articles[index]);
    return {
      articles: members,
      similarityScore: averagePairwiseScore(indexes, pairScores),
    };
  });
}

/** Sync wrapper for call sites that remain synchronous in tests/helpers. */
export function clusterRelatedStoriesSync(
  articles: NormalizedArticle[],
  threshold?: number,
): NormalizedArticle[][] {
  const config = getScoringConfig();
  const cutoff = threshold ?? config.STORY_CLUSTER_SIMILARITY_THRESHOLD;
  const similarity = getSimilarityProvider("deterministic");
  const uf = new UnionFind(articles.length);

  for (let i = 0; i < articles.length; i += 1) {
    for (let j = i + 1; j < articles.length; j += 1) {
      const score = similarity.similarity(
        {
          title: articles[i].title,
          normalizedTitle: articles[i].normalizedTitle,
          snippet: articles[i].snippet,
        },
        {
          title: articles[j].title,
          normalizedTitle: articles[j].normalizedTitle,
          snippet: articles[j].snippet,
        },
      );
      const resolved = typeof score === "number" ? score : 0;
      if (resolved >= cutoff) {
        uf.union(i, j);
      }
    }
  }

  const groups = new Map<number, NormalizedArticle[]>();
  for (let i = 0; i < articles.length; i += 1) {
    const root = uf.find(i);
    const list = groups.get(root) ?? [];
    list.push(articles[i]);
    groups.set(root, list);
  }
  return [...groups.values()];
}

function averagePairwiseScore(
  indexes: number[],
  pairScores: Map<string, number>,
): number {
  if (indexes.length <= 1) {
    return 1;
  }

  let sum = 0;
  let count = 0;
  for (let i = 0; i < indexes.length; i += 1) {
    for (let j = i + 1; j < indexes.length; j += 1) {
      const a = Math.min(indexes[i], indexes[j]);
      const b = Math.max(indexes[i], indexes[j]);
      sum += pairScores.get(`${a}:${b}`) ?? 0;
      count += 1;
    }
  }
  return count === 0 ? 1 : Math.round((sum / count) * 10000) / 10000;
}
