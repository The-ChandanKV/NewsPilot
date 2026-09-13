import { logger } from "@/lib/logger";

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(
    message: string,
    options?: {
      statusCode?: number;
      code?: string;
      details?: unknown;
      cause?: unknown;
    },
  ) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = "AppError";
    this.statusCode = options?.statusCode ?? 500;
    this.code = options?.code ?? "INTERNAL_ERROR";
    this.details = options?.details;
  }
}

const SECRETISH =
  /\b(api[_-]?key|secret|token|password|authorization|bearer)\b/i;

function scrubClientMessage(message: string): string {
  if (!SECRETISH.test(message)) return message.slice(0, 300);
  return "An upstream provider error occurred";
}

function safeClientDetails(details: unknown): unknown {
  if (details == null) return undefined;
  if (typeof details !== "object") return details;
  const record = details as Record<string, unknown>;
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (SECRETISH.test(key) || key === "bodyPreview" || key === "body") {
      continue;
    }
    if (typeof value === "string") {
      safe[key] = value.slice(0, 200);
    } else if (
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    ) {
      safe[key] = value;
    }
  }
  return Object.keys(safe).length > 0 ? safe : undefined;
}

/**
 * Convert errors into API responses without leaking secrets or provider bodies.
 */
export function toErrorResponse(error: unknown): {
  statusCode: number;
  body: {
    error: {
      message: string;
      code: string;
      details?: unknown;
    };
  };
} {
  if (error instanceof AppError) {
    const statusCode = error.statusCode;
    const exposeDetails = statusCode < 500;
    return {
      statusCode,
      body: {
        error: {
          message: scrubClientMessage(error.message),
          code: error.code,
          ...(exposeDetails
            ? { details: safeClientDetails(error.details) }
            : {}),
        },
      },
    };
  }

  logger.error("Unhandled error sanitized for client", {
    error: error instanceof Error ? error.message : String(error),
  });

  return {
    statusCode: 500,
    body: {
      error: {
        message: "An unexpected error occurred",
        code: "INTERNAL_ERROR",
      },
    },
  };
}
