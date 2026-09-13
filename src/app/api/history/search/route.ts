import { NextRequest, NextResponse } from "next/server";
import { migrate } from "@/lib/db/migrate";
import { toErrorResponse } from "@/lib/errors";
import { logger } from "@/lib/logger";
import {
  attachClientIdCookie,
  ensureClientId,
} from "@/lib/topics/client-id";
import { clearSearchHistory, recordSearch } from "@/lib/history/store";

export const runtime = "nodejs";

/**
 * POST /api/history/search — record / bump a topic search.
 * DELETE /api/history/search — clear search history only.
 */
export async function POST(request: NextRequest) {
  try {
    migrate();
    const { clientId, isNew } = ensureClientId(request);
    const payload = (await request.json().catch(() => null)) as {
      topic?: string;
      storyCount?: number;
      briefingAt?: string;
    } | null;

    const entry = recordSearch(clientId, payload?.topic ?? "", {
      storyCount: payload?.storyCount,
      briefingAt: payload?.briefingAt,
    });

    const response = NextResponse.json({ entry }, { status: 201 });
    return attachClientIdCookie(response, clientId, isNew);
  } catch (error) {
    logger.error("POST /api/history/search failed", {
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
    const searchesCleared = clearSearchHistory(clientId);
    const response = NextResponse.json({ ok: true, searchesCleared });
    return attachClientIdCookie(response, clientId, isNew);
  } catch (error) {
    logger.error("DELETE /api/history/search failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    const { statusCode, body } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}
