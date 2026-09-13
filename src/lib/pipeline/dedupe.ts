import type { NormalizedArticle } from "@/lib/pipeline/normalize";
import { headlineSimilarity } from "@/lib/utils/similarity";
import { getScoringConfig } from "@/config/scoring";
import { sourceTierScore } from "@/lib/scoring/source-quality";

function pickPreferred(a: NormalizedArticle, b: NormalizedArticle): NormalizedArticle {
  const tierA = sourceTierScore(a.sourceTier ?? 3);
  const tierB = sourceTierScore(b.sourceTier ?? 3);
  if (tierA !== tierB) {
    return tierA > tierB ? a : b;
  }

  const lenA = a.snippet?.length ?? 0;
  const lenB = b.snippet?.length ?? 0;
  if (lenA !== lenB) {
    return lenA > lenB ? a : b;
  }

  const timeA = a.publishedAt ? Date.parse(a.publishedAt) : 0;
  const timeB = b.publishedAt ? Date.parse(b.publishedAt) : 0;
  return timeA >= timeB ? a : b;
}

function sourceKey(article: NormalizedArticle): string {
  return article.sourceName.trim().toLowerCase();
}

/** Remove exact / canonical URL duplicates, keeping the stronger article. */
export function dedupeExactUrls(articles: NormalizedArticle[]): NormalizedArticle[] {
  const byUrl = new Map<string, NormalizedArticle>();

  for (const article of articles) {
    const key = article.canonicalUrl || article.url;
    const existing = byUrl.get(key);
    if (!existing) {
      byUrl.set(key, article);
      continue;
    }
    byUrl.set(key, pickPreferred(existing, article));
  }

  return [...byUrl.values()];
}

/**
 * Collapse near-duplicate headlines from the *same* source only
 * (e.g. syndicated re-posts). Different outlets covering the same event
 * are preserved for clustering so source diversity is retained.
 */
export function collapseNearDuplicateHeadlines(
  articles: NormalizedArticle[],
  threshold?: number,
): NormalizedArticle[] {
  const config = getScoringConfig();
  const cutoff = threshold ?? config.HEADLINE_NEAR_DUPLICATE_THRESHOLD;
  const kept: NormalizedArticle[] = [];

  for (const article of articles) {
    let merged = false;
    for (let i = 0; i < kept.length; i += 1) {
      if (sourceKey(kept[i]) !== sourceKey(article)) {
        continue;
      }
      const similarity = headlineSimilarity(kept[i].title, article.title);
      if (similarity >= cutoff) {
        kept[i] = pickPreferred(kept[i], article);
        merged = true;
        break;
      }
    }
    if (!merged) {
      kept.push(article);
    }
  }

  return kept;
}

/** True when two headlines are near-duplicates at the configured threshold. */
export function areNearDuplicateHeadlines(
  titleA: string,
  titleB: string,
  threshold?: number,
): boolean {
  const config = getScoringConfig();
  const cutoff = threshold ?? config.HEADLINE_NEAR_DUPLICATE_THRESHOLD;
  return headlineSimilarity(titleA, titleB) >= cutoff;
}
