/**
 * Parse many common news date formats into an ISO-8601 UTC string.
 * Returns undefined when the value cannot be parsed.
 */
export function normalizePublishedAt(value: unknown): string | undefined {
  if (value == null) {
    return undefined;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    // Heuristic: seconds vs milliseconds
    const ms = value < 1e12 ? value * 1000 : value;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return parsed.toISOString();
}

export function isWithinRecencyWindow(
  publishedAt: string | undefined,
  recencyHours: number,
  now: Date = new Date(),
): boolean {
  if (!publishedAt) {
    // Missing dates are kept; callers may sort them lower.
    return true;
  }

  const published = new Date(publishedAt);
  if (Number.isNaN(published.getTime())) {
    return true;
  }

  const cutoff = now.getTime() - recencyHours * 60 * 60 * 1000;
  return published.getTime() >= cutoff;
}
