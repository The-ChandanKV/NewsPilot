import { NextRequest, NextResponse } from "next/server";
import { migrate } from "@/lib/db/migrate";
import { toErrorResponse } from "@/lib/errors";
import { logger } from "@/lib/logger";
import {
  attachClientIdCookie,
  ensureClientId,
} from "@/lib/topics/client-id";
import {
  clearRecentlyViewed,
  recordStoryView,
} from "@/lib/history/store";

export const runtime = "nodejs";

/**
 * POST /api/history/viewed — record a story open (lightweight refs only).
 * DELETE /api/history/viewed — clear recently viewed.
 */
export async function POST(request: NextRequest) {
  try {
    migrate();
    const { clientId, isNew } = ensureClientId(request);
    const payload = (await request.json().catch(() => null)) as {
      storyRefId?: string;
      headline?: string;
      source?: string;
      url?: string;
      topic?: string;
    } | null;

    const entry = recordStoryView(clientId, {
      storyRefId: payload?.storyRefId ?? "",
      headline: payload?.headline ?? "",
      source: payload?.source ?? "",
      url: payload?.url ?? "",
      topic: payload?.topic ?? "",
    });

    const response = NextResponse.json({ entry }, { status: 201 });
    return attachClientIdCookie(response, clientId, isNew);
  } catch (error) {
    logger.error("POST /api/history/viewed failed", {
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
    const viewedCleared = clearRecentlyViewed(clientId);
    const response = NextResponse.json({ ok: true, viewedCleared });
    return attachClientIdCookie(response, clientId, isNew);
  } catch (error) {
    logger.error("DELETE /api/history/viewed failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    const { statusCode, body } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}
