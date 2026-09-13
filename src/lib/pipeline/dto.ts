import type { Article, NewsArticleDto } from "@/types/briefing";

export function toNewsArticleDto(article: Article, topic: string): NewsArticleDto {
  return {
    id: article.id,
    title: article.title,
    url: article.url,
    source: article.sourceName,
    publishedAt: article.publishedAt ?? null,
    author: article.author ?? null,
    description: article.snippet ?? null,
    topic: article.topic ?? topic,
    imageUrl: article.imageUrl ?? null,
    provider: article.provider,
  };
}
