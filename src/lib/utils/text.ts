/** Strip tags and decode a few common HTML entities from RSS snippets. */
export function stripHtml(input: string): string {
  return input
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeTopic(topic: string): string {
  return topic.trim().replace(/\s+/g, " ").toLowerCase();
}

export function tokenizeTopic(topic: string): string[] {
  return normalizeTopic(topic)
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 2);
}

/**
 * Lightweight keyword relevance: fraction of topic tokens found in title+snippet.
 * No LLM involved.
 */
export function relevanceScore(topic: string, title: string, snippet?: string): number {
  const tokens = tokenizeTopic(topic);
  if (tokens.length === 0) {
    return 1;
  }

  const haystack = `${title} ${snippet ?? ""}`.toLowerCase();
  let hits = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) {
      hits += 1;
    }
  }
  return hits / tokens.length;
}

export function isRelevantToTopic(
  topic: string,
  title: string,
  snippet?: string,
  minimumScore = 0,
): boolean {
  const normalized = normalizeTopic(topic);
  const haystack = `${title} ${snippet ?? ""}`.toLowerCase();

  if (!normalized) {
    return true;
  }

  if (haystack.includes(normalized)) {
    return true;
  }

  const score = relevanceScore(topic, title, snippet);
  if (minimumScore <= 0) {
    // Keep articles that match at least one meaningful topic token.
    return score > 0;
  }
  return score >= minimumScore;
}
