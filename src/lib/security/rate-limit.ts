import { AppError } from "@/lib/errors";

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

export type RateLimitOptions = {
  /** Unique key, e.g. `research:ip:1.2.3.4` */
  key: string;
  /** Max requests in the window */
  limit: number;
  /** Window length in ms */
  windowMs: number;
};

/**
 * Simple in-memory fixed-window rate limiter (per process).
 * Suitable for local/single-node deployments — not a distributed quota system.
 */
export function assertRateLimit(options: RateLimitOptions): void {
  const now = Date.now();
  const existing = buckets.get(options.key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(options.key, {
      count: 1,
      resetAt: now + options.windowMs,
    });
    return;
  }

  if (existing.count >= options.limit) {
    const retryAfterSec = Math.max(
      1,
      Math.ceil((existing.resetAt - now) / 1000),
    );
    throw new AppError("Too many requests. Please retry shortly.", {
      statusCode: 429,
      code: "RATE_LIMITED",
      details: { retryAfterSec },
    });
  }

  existing.count += 1;
}

/** Test helper */
export function resetRateLimitBucketsForTests(): void {
  buckets.clear();
}

export function clientRateLimitKey(
  route: string,
  request: Request,
  clientId?: string,
): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip =
    forwarded?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "local";
  return `${route}:${ip}:${clientId ?? "anon"}`;
}
