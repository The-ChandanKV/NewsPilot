import { getEnv } from "@/config/env";
import { AppError } from "@/lib/errors";
import type { NewsProvider, NewsSearchOptions } from "@/lib/providers/news/types";
import type { Article } from "@/types/briefing";

export class NewsApiProvider implements NewsProvider {
  readonly name = "newsapi" as const;

  isConfigured(): boolean {
    return Boolean(getEnv().NEWSAPI_API_KEY);
  }

  async search(_options: NewsSearchOptions): Promise<Article[]> {
    if (!this.isConfigured()) {
      throw new AppError("NewsAPI key is not configured", {
        statusCode: 503,
        code: "NEWS_PROVIDER_NOT_CONFIGURED",
        details: { provider: this.name },
      });
    }

    void _options;
    throw new AppError("NewsAPI search is not implemented yet", {
      statusCode: 501,
      code: "NEWS_NOT_IMPLEMENTED",
      details: { provider: this.name },
    });
  }
}
