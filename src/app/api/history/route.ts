import { NextRequest, NextResponse } from "next/server";
import { migrate } from "@/lib/db/migrate";
import { toErrorResponse } from "@/lib/errors";
import { logger } from "@/lib/logger";
import {
  attachClientIdCookie,
  ensureClientId,
} from "@/lib/topics/client-id";
import { clearHistory, getHistoryLibrary } from "@/lib/history/store";
import { listUserTopics } from "@/lib/topics/store";

export const runtime = "nodejs";

/**
 * GET /api/history — recent searches, full search history, saved stories,
 * recently viewed, plus saved topics (from user_topics).
 * DELETE /api/history — clear search history + recently viewed (keeps saves).
 */
export async function GET(request: NextRequest) {
  try {
    migrate();
    const { clientId, isNew } = ensureClientId(request);
    const library = getHistoryLibrary(clientId);
    const savedTopics = listUserTopics(clientId);
    const response = NextResponse.json({
      ...library,
      savedTopics,
    });
    return attachClientIdCookie(response, clientId, isNew);
  } catch (error) {
    logger.error("GET /api/history failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    const { statusCode, body } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    migrate();
    const { clientId, isNew } = ensureClientId(request);
    const cleared = clearHistory(clientId);
    const response = NextResponse.json({ ok: true, ...cleared });
    return attachClientIdCookie(response, clientId, isNew);
  } catch (error) {
    logger.error("DELETE /api/history failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    const { statusCode, body } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}
