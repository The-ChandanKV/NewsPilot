import { normalizePublishedAt } from "@/lib/utils/dates";
import { canonicalizeUrl, isValidHttpUrl } from "@/lib/utils/url";
import { resolveSourceTier } from "@/lib/scoring/source-quality";
import { normalizeHeadline } from "@/lib/utils/similarity";
import type { Article } from "@/types/briefing";

export type NormalizedArticle = Article & {
  normalizedTitle: string;
};

/**
 * Normalize raw articles for deterministic downstream processing.
 */
export function normalizeArticles(articles: Article[]): NormalizedArticle[] {
  const result: NormalizedArticle[] = [];

  for (const article of articles) {
    const title = article.title?.trim();
    const url = article.url?.trim();
    if (!title || !url || !isValidHttpUrl(url)) {
      continue;
    }

    let canonicalUrl = article.canonicalUrl;
    try {
      canonicalUrl = canonicalizeUrl(url);
    } catch {
      continue;
    }

    const publishedAt = normalizePublishedAt(article.publishedAt) ?? article.publishedAt;

    result.push({
      ...article,
      title,
      url,
      canonicalUrl,
      snippet: article.snippet?.trim() || undefined,
      sourceName: article.sourceName?.trim() || "Unknown",
      publishedAt,
      sourceTier: article.sourceTier ?? resolveSourceTier(article.sourceName, url),
      normalizedTitle: normalizeHeadline(title),
    });
  }

  return result;
}
