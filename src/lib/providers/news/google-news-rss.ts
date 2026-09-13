import fs from "fs";
import path from "path";
import { getEnv } from "@/config/env";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { NewsProvider, NewsSearchOptions } from "@/lib/providers/news/types";
import { normalizePublishedAt } from "@/lib/utils/dates";
import { fetchWithRetry } from "@/lib/utils/http";
import { normalizeTopic, stripHtml } from "@/lib/utils/text";
import { articleIdFromUrl, canonicalizeUrl, isValidHttpUrl } from "@/lib/utils/url";
import type { Article } from "@/types/briefing";

type RawRssItem = {
  title?: string;
  link?: string;
  pubDate?: string;
  description?: string;
  sourceName?: string;
  sourceUrl?: string;
  guid?: string;
};

function decodeXmlEntities(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

function extractTag(block: string, tag: string): string | undefined {
  const cdata = new RegExp(
    `<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`,
    "i",
  );
  const cdataMatch = block.match(cdata);
  if (cdataMatch?.[1]) {
    return decodeXmlEntities(cdataMatch[1].trim());
  }

  const normal = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const match = block.match(normal);
  if (!match?.[1]) {
    return undefined;
  }
  return decodeXmlEntities(match[1].trim());
}

function extractSource(block: string): { name?: string; url?: string } {
  const match = block.match(/<source\b([^>]*)>([\s\S]*?)<\/source>/i);
  if (!match) {
    return {};
  }
  const attrs = match[1] ?? "";
  const urlMatch = attrs.match(/url=["']([^"']+)["']/i);
  return {
    name: decodeXmlEntities((match[2] ?? "").trim()) || undefined,
    url: urlMatch?.[1],
  };
}

/**
 * Minimal RSS item parser — no XML library required.
 * Tolerates malformed items by skipping them.
 */
export function parseRssItems(xml: string): RawRssItem[] {
  if (!xml || typeof xml !== "string") {
    return [];
  }

  const items: RawRssItem[] = [];
  const itemRegex = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1] ?? "";
    try {
      const source = extractSource(block);
      items.push({
        title: extractTag(block, "title"),
        link: extractTag(block, "link"),
        pubDate: extractTag(block, "pubDate"),
        description: extractTag(block, "description"),
        guid: extractTag(block, "guid"),
        sourceName: source.name,
        sourceUrl: source.url,
      });
    } catch {
      // Skip malformed item blocks
    }
  }

  return items;
}

function topicToSlug(topic: string): string {
  return normalizeTopic(topic).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function splitTitleAndSource(
  title: string,
  fallbackSource?: string,
): { title: string; sourceName: string } {
  const separator = " - ";
  const index = title.lastIndexOf(separator);
  if (index > 0 && !fallbackSource) {
    return {
      title: title.slice(0, index).trim(),
      sourceName: title.slice(index + separator.length).trim() || "Unknown",
    };
  }
  if (index > 0 && fallbackSource && title.endsWith(separator + fallbackSource)) {
    return {
      title: title.slice(0, index).trim(),
      sourceName: fallbackSource,
    };
  }
  return {
    title: title.trim(),
    sourceName: fallbackSource?.trim() || "Unknown",
  };
}

function extractImageUrl(descriptionHtml: string | undefined): string | undefined {
  if (!descriptionHtml) {
    return undefined;
  }
  const match = descriptionHtml.match(/<img[^>]+src=["']([^"']+)["']/i);
  const src = match?.[1];
  return src && isValidHttpUrl(src) ? src : undefined;
}

function mapItemsToArticles(
  rawItems: RawRssItem[],
  topic: string,
  maxResults: number,
): Article[] {
  const fetchedAt = new Date().toISOString();
  const articles: Article[] = [];

  for (const item of rawItems) {
    try {
      const rawUrl = item.link?.trim() || item.guid?.trim();
      if (!rawUrl || !isValidHttpUrl(rawUrl)) {
        continue;
      }

      const rawTitle = item.title?.trim();
      if (!rawTitle) {
        continue;
      }

      const { title, sourceName } = splitTitleAndSource(rawTitle, item.sourceName);
      const canonicalUrl = canonicalizeUrl(rawUrl);
      const descriptionHtml = item.description;
      const snippet = descriptionHtml ? stripHtml(descriptionHtml) : undefined;

      articles.push({
        id: articleIdFromUrl(canonicalUrl),
        externalId: item.guid,
        url: rawUrl,
        canonicalUrl,
        title,
        snippet: snippet || undefined,
        sourceName,
        author: undefined,
        publishedAt: normalizePublishedAt(item.pubDate),
        fetchedAt,
        provider: "google_news_rss",
        topic,
        imageUrl: extractImageUrl(descriptionHtml),
      });
    } catch (error) {
      logger.warn("Skipping malformed RSS item", {
        provider: "google_news_rss",
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (articles.length >= maxResults) {
      break;
    }
  }

  return articles;
}

function resolveFixturePath(topic: string, fixtureDir: string): string {
  const slug = topicToSlug(topic);
  const absoluteDir = path.isAbsolute(fixtureDir)
    ? fixtureDir
    : path.join(process.cwd(), fixtureDir);
  return path.join(absoluteDir, `${slug}.xml`);
}

/**
 * Google News RSS search provider (no API key).
 * Provider-specific parsing stays isolated here.
 *
 * Set NEWS_RSS_FIXTURE_DIR to load `{topic-slug}.xml` files instead of live HTTP
 * (useful for offline/dev testing).
 */
export class GoogleNewsRssProvider implements NewsProvider {
  readonly name = "google_news_rss" as const;

  isConfigured(): boolean {
    return true;
  }

  async search(options: NewsSearchOptions): Promise<Article[]> {
    const topic = options.topic?.trim();
    if (!topic) {
      throw new AppError("Topic is required for news search", {
        statusCode: 400,
        code: "INVALID_TOPIC",
      });
    }

    const env = getEnv();
    const maxResults = options.maxResults ?? env.MAX_ARTICLES_PER_SEARCH;
    const xml = await this.loadRssXml(topic, env);

    if (!xml.includes("<item") && !xml.includes("<rss") && !xml.includes("<feed")) {
      throw new AppError("Malformed Google News RSS response", {
        statusCode: 502,
        code: "NEWS_MALFORMED_RESPONSE",
        details: { provider: this.name, preview: xml.slice(0, 160) },
      });
    }

    const rawItems = parseRssItems(xml);
    const articles = mapItemsToArticles(rawItems, topic, maxResults);

    logger.info("Google News RSS fetch complete", {
      topic,
      rawCount: rawItems.length,
      articleCount: articles.length,
      fixtureMode: Boolean(env.NEWS_RSS_FIXTURE_DIR),
    });

    return articles;
  }

  private async loadRssXml(
    topic: string,
    env: ReturnType<typeof getEnv>,
  ): Promise<string> {
    if (env.NEWS_RSS_FIXTURE_DIR) {
      const fixturePath = resolveFixturePath(topic, env.NEWS_RSS_FIXTURE_DIR);
      if (!fs.existsSync(fixturePath)) {
        throw new AppError(`RSS fixture not found for topic "${topic}"`, {
          statusCode: 404,
          code: "NEWS_FIXTURE_NOT_FOUND",
          details: { fixturePath },
        });
      }
      logger.info("Loading Google News RSS fixture", { topic, fixturePath });
      return fs.readFileSync(fixturePath, "utf8");
    }

    const query = encodeURIComponent(topic);
    const url =
      `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`;

    logger.info("Fetching Google News RSS", { topic });

    const response = await fetchWithRetry(url, {
      timeoutMs: env.NEWS_PROVIDER_TIMEOUT_MS,
      maxRetries: env.NEWS_PROVIDER_MAX_RETRIES,
      headers: {
        Accept: "application/rss+xml, application/xml, text/xml, */*",
        "User-Agent": "NewsPilot/0.1 (+local-dev)",
      },
    });

    return response.text();
  }
}
