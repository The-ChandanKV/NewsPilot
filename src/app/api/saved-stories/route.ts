import { NextRequest, NextResponse } from "next/server";
import { migrate } from "@/lib/db/migrate";
import { toErrorResponse } from "@/lib/errors";
import { logger } from "@/lib/logger";
import {
  attachClientIdCookie,
  ensureClientId,
} from "@/lib/topics/client-id";
import {
  listSavedStories,
  listSavedStoryRefIds,
  saveStory,
} from "@/lib/history/store";

export const runtime = "nodejs";

/**
 * GET /api/saved-stories — list saved bookmarks.
 * POST /api/saved-stories — save a story (idempotent by storyRefId).
 */
export async function GET(request: NextRequest) {
  try {
    migrate();
    const { clientId, isNew } = ensureClientId(request);
    const stories = listSavedStories(clientId);
    const savedRefIds = listSavedStoryRefIds(clientId);
    const response = NextResponse.json({ stories, savedRefIds });
    return attachClientIdCookie(response, clientId, isNew);
  } catch (error) {
    logger.error("GET /api/saved-stories failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    const { statusCode, body } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}

export async function POST(request: NextRequest) {
  try {
    migrate();
    const { clientId, isNew } = ensureClientId(request);
    const payload = (await request.json().catch(() => null)) as {
      storyRefId?: string;
      headline?: string;
      summary?: string;
      source?: string;
      url?: string;
      topic?: string;
    } | null;

    const story = saveStory(clientId, {
      storyRefId: payload?.storyRefId ?? "",
      headline: payload?.headline ?? "",
      summary: payload?.summary ?? "",
      source: payload?.source ?? "",
      url: payload?.url ?? "",
      topic: payload?.topic ?? "",
    });

    const response = NextResponse.json({ story }, { status: 201 });
    return attachClientIdCookie(response, clientId, isNew);
  } catch (error) {
    logger.error("POST /api/saved-stories failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    const { statusCode, body } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}
