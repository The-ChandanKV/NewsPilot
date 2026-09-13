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
    return {
      statusCode: error.statusCode,
      body: {
        error: {
          message: error.message,
          code: error.code,
          details: error.details,
        },
      },
    };
  }

  const message =
    error instanceof Error ? error.message : "An unexpected error occurred";

  return {
    statusCode: 500,
    body: {
      error: {
        message,
        code: "INTERNAL_ERROR",
      },
    },
  };
}
