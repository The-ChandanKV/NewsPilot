import { AppError } from "@/lib/errors";
import { isValidHttpUrl } from "@/lib/utils/url";

/**
 * Validate URLs used in prompts / citations.
 * Only http(s) without credentials. Rejects javascript:, data:, etc.
 */
export function assertSafeHttpUrl(value: string, field = "url"): string {
  const trimmed = value.trim();
  if (!isValidHttpUrl(trimmed)) {
    throw new AppError(`Invalid ${field}: only http(s) URLs are allowed`, {
      statusCode: 400,
      code: "INVALID_URL",
    });
  }
  const parsed = new URL(trimmed);
  if (parsed.username || parsed.password) {
    throw new AppError(`Invalid ${field}: credentials in URLs are not allowed`, {
      statusCode: 400,
      code: "INVALID_URL",
    });
  }
  return trimmed;
}

/**
 * Soft sanitize for prompt inclusion — drops unsafe schemes instead of throwing.
 */
export function sanitizeUrlForPrompt(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return assertSafeHttpUrl(value);
  } catch {
    return null;
  }
}
