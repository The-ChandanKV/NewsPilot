import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

export type FetchWithRetryOptions = {
  method?: "GET" | "POST";
  body?: string;
  timeoutMs?: number;
  maxRetries?: number;
  headers?: HeadersInit;
  retryOnStatuses?: number[];
  /** Override error codes in thrown AppErrors (defaults suit news providers). */
  errorNamespace?: "news" | "ai";
};

const DEFAULT_RETRY_STATUSES = [408, 425, 429, 500, 502, 503, 504];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.message.toLowerCase().includes("aborted"))
  );
}

function codesFor(namespace: "news" | "ai") {
  if (namespace === "ai") {
    return {
      rateLimited: "AI_RATE_LIMITED",
      http: "AI_PROVIDER_HTTP_ERROR",
      timeout: "AI_PROVIDER_TIMEOUT",
      network: "AI_PROVIDER_NETWORK_ERROR",
      rateMessage: "AI provider rate limit exceeded",
      timeoutMessage: "AI provider request timed out",
      networkMessage: "AI provider request failed",
    } as const;
  }
  return {
    rateLimited: "NEWS_RATE_LIMITED",
    http: "NEWS_PROVIDER_HTTP_ERROR",
    timeout: "NEWS_PROVIDER_TIMEOUT",
    network: "NEWS_PROVIDER_NETWORK_ERROR",
    rateMessage: "News provider rate limit exceeded",
    timeoutMessage: "News provider request timed out",
    networkMessage: "News provider request failed",
  } as const;
}

/**
 * fetch() with AbortController timeout + exponential backoff retries.
 */
export async function fetchWithRetry(
  url: string,
  options: FetchWithRetryOptions = {},
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxRetries = options.maxRetries ?? 2;
  const retryOnStatuses = options.retryOnStatuses ?? DEFAULT_RETRY_STATUSES;
  const method = options.method ?? "GET";
  const codes = codesFor(options.errorNamespace ?? "news");

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method,
        headers: options.headers,
        body: options.body,
        signal: controller.signal,
        redirect: "follow",
      });

      if (response.ok) {
        return response;
      }

      const status = response.status;
      const bodyPreview = (await response.text().catch(() => "")).slice(0, 200);
      const error =
        status === 429
          ? new AppError(codes.rateMessage, {
              statusCode: 429,
              code: codes.rateLimited,
              details: { status, bodyPreview },
            })
          : new AppError(`Provider HTTP ${status}`, {
              statusCode: status >= 500 ? 502 : status,
              code: codes.http,
              details: { status, bodyPreview },
            });

      lastError = error;
      const shouldRetry = retryOnStatuses.includes(status) && attempt < maxRetries;
      if (!shouldRetry) {
        throw error;
      }

      const backoffMs = 400 * 2 ** attempt;
      logger.warn("Retrying provider request", {
        url: url.split("?")[0],
        status,
        attempt: attempt + 1,
        backoffMs,
        namespace: options.errorNamespace ?? "news",
      });
      await sleep(backoffMs);
    } catch (error) {
      clearTimeout(timer);

      if (error instanceof AppError) {
        throw error;
      }

      const timedOut = isAbortError(error);
      lastError = new AppError(
        timedOut ? codes.timeoutMessage : codes.networkMessage,
        {
          statusCode: 504,
          code: timedOut ? codes.timeout : codes.network,
          cause: error,
          details: {
            reason: error instanceof Error ? error.message : String(error),
          },
        },
      );

      if (attempt >= maxRetries) {
        throw lastError;
      }

      const backoffMs = 400 * 2 ** attempt;
      logger.warn("Retrying provider after network/timeout error", {
        attempt: attempt + 1,
        backoffMs,
        error: error instanceof Error ? error.message : String(error),
      });
      await sleep(backoffMs);
      continue;
    } finally {
      clearTimeout(timer);
    }
  }

  throw (
    lastError ??
    new AppError(codes.networkMessage, {
      statusCode: 502,
      code: codes.network,
    })
  );
}
