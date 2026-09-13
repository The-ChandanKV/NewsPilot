import { createHash } from "crypto";

const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "ref",
]);

export function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Normalize URLs for deduplication: lowercase host, strip www/tracking/hash, drop trailing slash.
 */
export function canonicalizeUrl(rawUrl: string): string {
  const url = new URL(rawUrl.trim());
  url.hash = "";
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");

  const params = new URLSearchParams(url.search);
  for (const key of [...params.keys()]) {
    if (TRACKING_PARAMS.has(key.toLowerCase()) || key.toLowerCase().startsWith("utm_")) {
      params.delete(key);
    }
  }
  url.search = params.toString();

  let normalized = url.toString();
  if (normalized.endsWith("/") && url.pathname !== "/") {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

export function articleIdFromUrl(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 16);
}
