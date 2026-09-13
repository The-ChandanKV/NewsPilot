import { AppError } from "@/lib/errors";

const DEFAULT_MAX_BYTES = 64 * 1024;

/**
 * Read JSON with a hard size limit. Rejects oversized Content-Length early
 * and also checks the buffered body length.
 */
export async function readJsonWithLimit<T = unknown>(
  request: Request,
  options?: { maxBytes?: number },
): Promise<T> {
  const maxBytes = options?.maxBytes ?? DEFAULT_MAX_BYTES;
  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const length = Number(contentLength);
    if (Number.isFinite(length) && length > maxBytes) {
      throw new AppError("Request body too large", {
        statusCode: 413,
        code: "REQUEST_TOO_LARGE",
        details: { maxBytes },
      });
    }
  }

  const text = await request.text();
  if (text.length > maxBytes) {
    throw new AppError("Request body too large", {
      statusCode: 413,
      code: "REQUEST_TOO_LARGE",
      details: { maxBytes },
    });
  }

  if (!text.trim()) {
    return {} as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new AppError("Invalid JSON body", {
      statusCode: 400,
      code: "INVALID_JSON",
    });
  }
}

export function assertTopicLength(topic: string, max = 120): string {
  const trimmed = topic.trim();
  if (!trimmed) {
    throw new AppError("topic is required", {
      statusCode: 400,
      code: "INVALID_TOPIC",
    });
  }
  if (trimmed.length > max) {
    throw new AppError(`topic must be at most ${max} characters`, {
      statusCode: 400,
      code: "TOPIC_TOO_LONG",
    });
  }
  return trimmed;
}
