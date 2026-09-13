import type { Article, NewsProviderName } from "@/types/briefing";

export interface NewsSearchOptions {
  topic: string;
  maxResults?: number;
  recencyHours?: number;
}

/**
 * Replaceable news/search provider contract.
 * Keep provider-specific HTTP/parsing behind this interface.
 */
export interface NewsProvider {
  readonly name: NewsProviderName;
  isConfigured(): boolean;
  search(options: NewsSearchOptions): Promise<Article[]>;
}
