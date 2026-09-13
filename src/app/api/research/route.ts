import { NextRequest, NextResponse } from "next/server";
import { migrate } from "@/lib/db/migrate";
import { toErrorResponse } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { answerResearchQuestion } from "@/lib/research/answer";
import {
  assertRateLimit,
  clientRateLimitKey,
  readJsonWithLimit,
} from "@/lib/security";
import {
  attachClientIdCookie,
  ensureClientId,
} from "@/lib/topics/client-id";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/research — grounded news research chat (RAG over stored stories).
 * Server-side AI only; request size + rate limited.
 */
export async function POST(request: NextRequest) {
  try {
    migrate();
    const { clientId, isNew } = ensureClientId(request);
    assertRateLimit({
      key: clientRateLimitKey("research", request, clientId),
      limit: 20,
      windowMs: 60_000,
    });

    const payload = await readJsonWithLimit<{
      question?: string;
      focusStoryIds?: string[];
      priorExchange?: { question: string; answer: string };
    }>(request, { maxBytes: 32 * 1024 });

    const focusStoryIds = Array.isArray(payload.focusStoryIds)
      ? payload.focusStoryIds.slice(0, 20).map(String)
      : undefined;

    const result = await answerResearchQuestion({
      question: payload.question ?? "",
      clientId,
      focusStoryIds,
      priorExchange: payload.priorExchange
        ? {
            question: String(payload.priorExchange.question ?? "").slice(0, 2000),
            answer: String(payload.priorExchange.answer ?? "").slice(0, 4000),
          }
        : undefined,
    });

    const response = NextResponse.json(result);
    return attachClientIdCookie(response, clientId, isNew);
  } catch (error) {
    logger.error("POST /api/research failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    const { statusCode, body } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}
