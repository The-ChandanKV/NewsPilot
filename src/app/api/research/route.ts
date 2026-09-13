import { NextRequest, NextResponse } from "next/server";
import { migrate } from "@/lib/db/migrate";
import { toErrorResponse } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { answerResearchQuestion } from "@/lib/research/answer";
import {
  attachClientIdCookie,
  ensureClientId,
} from "@/lib/topics/client-id";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/research — grounded news research chat (RAG over stored stories).
 */
export async function POST(request: NextRequest) {
  try {
    migrate();
    const { clientId, isNew } = ensureClientId(request);
    const payload = (await request.json().catch(() => ({}))) as {
      question?: string;
      focusStoryIds?: string[];
      priorExchange?: { question: string; answer: string };
    };

    const result = await answerResearchQuestion({
      question: payload.question ?? "",
      clientId,
      focusStoryIds: payload.focusStoryIds,
      priorExchange: payload.priorExchange,
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
