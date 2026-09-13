import { getEnabledNewsProviders } from "@/config/env";
import { AppError } from "@/lib/errors";
import { GoogleNewsRssProvider } from "@/lib/providers/news/google-news-rss";
import { GNewsProvider } from "@/lib/providers/news/gnews";
import { NewsApiProvider } from "@/lib/providers/news/newsapi";
import type { NewsProvider } from "@/lib/providers/news/types";
import type { NewsProviderName } from "@/types/briefing";

const registry: Record<NewsProviderName, () => NewsProvider> = {
  google_news_rss: () => new GoogleNewsRssProvider(),
  newsapi: () => new NewsApiProvider(),
  gnews: () => new GNewsProvider(),
};

export function getNewsProvider(name: NewsProviderName): NewsProvider {
  const factory = registry[name];
  if (!factory) {
    throw new AppError(`Unknown news provider: ${name}`, {
      statusCode: 500,
      code: "UNKNOWN_NEWS_PROVIDER",
    });
  }
  return factory();
}

export function getEnabledNewsProviderInstances(): NewsProvider[] {
  return getEnabledNewsProviders().map((name) => getNewsProvider(name));
}

export function getNewsProviderStatus(): {
  enabledProviders: NewsProviderName[];
  configuredProviders: NewsProviderName[];
} {
  const enabled = getEnabledNewsProviderInstances();
  return {
    enabledProviders: enabled.map((provider) => provider.name),
    configuredProviders: enabled
      .filter((provider) => provider.isConfigured())
      .map((provider) => provider.name),
  };
}
