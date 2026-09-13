import { NextRequest, NextResponse } from "next/server";
import { migrate } from "@/lib/db/migrate";
import { toErrorResponse } from "@/lib/errors";
import { logger } from "@/lib/logger";
import {
  attachClientIdCookie,
  ensureClientId,
} from "@/lib/topics/client-id";
import { unsaveStory, unsaveStoryByRef } from "@/lib/history/store";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * DELETE /api/saved-stories/:id — unsave by bookmark id.
 * Pass ?byRef=1 to treat :id as storyRefId instead.
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    migrate();
    const { id } = await context.params;
    const { clientId, isNew } = ensureClientId(request);
    const byRef = request.nextUrl.searchParams.get("byRef");

    if (byRef === "1" || byRef === "true") {
      const removed = unsaveStoryByRef(clientId, id);
      if (!removed) {
        return NextResponse.json(
          {
            error: {
              message: "Saved story not found",
              code: "SAVED_STORY_NOT_FOUND",
            },
          },
          { status: 404 },
        );
      }
    } else {
      unsaveStory(clientId, id);
    }

    const response = NextResponse.json({ ok: true });
    return attachClientIdCookie(response, clientId, isNew);
  } catch (error) {
    logger.error("DELETE /api/saved-stories/[id] failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    const { statusCode, body } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}
