import { looksLikePromptInjection, sanitizeAiOutputText } from "@/lib/security/untrusted";
import { sanitizeUrlForPrompt } from "@/lib/security/urls";
import { canonicalizeUrl, isValidHttpUrl } from "@/lib/utils/url";

/**
 * Replace http(s) URLs in model output that are not on an allowlist
 * (typically retrieved citation URLs). Prevents phishing links from
 * injected article instructions surviving into the UI.
 */
export function filterAnswerUrlsToAllowlist(
  answer: string,
  allowedUrls: Iterable<string>,
): string {
  const allowed = new Set<string>();
  for (const raw of allowedUrls) {
    const safe = sanitizeUrlForPrompt(raw);
    if (!safe) continue;
    allowed.add(safe);
    try {
      allowed.add(canonicalizeUrl(safe));
    } catch {
      // ignore canonicalize failures
    }
  }

  return answer.replace(/https?:\/\/[^\s\]>'"]+/gi, (match) => {
    const cleaned = match.replace(/[.,);]+$/g, "");
    const trailing = match.slice(cleaned.length);
    const safe = sanitizeUrlForPrompt(cleaned);
    if (!safe) {
      return `[link omitted]${trailing}`;
    }
    let canonical = safe;
    try {
      canonical = canonicalizeUrl(safe);
    } catch {
      // keep safe
    }
    if (allowed.has(safe) || allowed.has(canonical)) {
      return `${safe}${trailing}`;
    }
    return `[link omitted]${trailing}`;
  });
}

/**
 * Reject model answers that look like successful prompt injection /
 * instruction echo rather than legitimate content.
 */
export function isUnsafeModelOutput(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return true;
  if (looksLikePromptInjection(normalized)) return true;
  if (/<<<\s*UNTRUSTED_/i.test(normalized)) return true;
  if (/^\s*(system|assistant|developer)\s*:/im.test(normalized)) return true;
  return false;
}

export function scrubModelOutputText(
  text: string,
  maxLength = 8000,
): string | null {
  const cleaned = sanitizeAiOutputText(text, maxLength);
  if (isUnsafeModelOutput(cleaned)) return null;
  return cleaned;
}

export function isSafeHttpUrlString(value: string): boolean {
  return Boolean(sanitizeUrlForPrompt(value));
}

export function collectSafeHttpUrls(values: Iterable<string | null | undefined>): string[] {
  const out: string[] = [];
  for (const value of values) {
    const safe = sanitizeUrlForPrompt(value);
    if (safe && isValidHttpUrl(safe)) out.push(safe);
  }
  return out;
}
