import { articleIdFromUrl, canonicalizeUrl } from "@/lib/utils/url";
import type { Article, NewsProviderName } from "@/types/briefing";

export function makeArticle(
  overrides: Partial<Article> & Pick<Article, "title" | "url" | "sourceName">,
): Article {
  const url = overrides.url;
  const canonicalUrl = overrides.canonicalUrl ?? canonicalizeUrl(url);
  return {
    id: overrides.id ?? articleIdFromUrl(canonicalUrl),
    externalId: overrides.externalId,
    url,
    canonicalUrl,
    title: overrides.title,
    snippet: overrides.snippet,
    sourceName: overrides.sourceName,
    author: overrides.author,
    publishedAt: overrides.publishedAt,
    fetchedAt: overrides.fetchedAt ?? new Date().toISOString(),
    provider: (overrides.provider ?? "google_news_rss") as NewsProviderName,
    topic: overrides.topic,
    imageUrl: overrides.imageUrl,
    sourceTier: overrides.sourceTier,
  };
}
