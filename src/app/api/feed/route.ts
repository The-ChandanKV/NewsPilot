import { NextRequest, NextResponse } from "next/server";
import { migrate } from "@/lib/db/migrate";
import { toErrorResponse } from "@/lib/errors";
import { logger } from "@/lib/logger";
import {
  attachClientIdCookie,
  ensureClientId,
} from "@/lib/topics/client-id";
import { buildPersonalizedFeed } from "@/lib/topics/personalized-feed";

export const runtime = "nodejs";

/**
 * GET /api/feed — combined personalized briefing across saved topics.
 * Reuses existing per-topic StoryCluster summaries (no extra AI pass).
 */
export async function GET(request: NextRequest) {
  try {
    migrate();
    const { clientId, isNew } = ensureClientId(request);
    const refresh = request.nextUrl.searchParams.get("refresh");
    const limitRaw = request.nextUrl.searchParams.get("limit");
    const forceRefresh = refresh === "1" || refresh === "true";

    let maxStories: number | undefined;
    if (limitRaw) {
      const parsed = Number.parseInt(limitRaw, 10);
      if (!Number.isFinite(parsed) || parsed < 1) {
        return NextResponse.json(
          {
            error: {
              message: "Query parameter 'limit' must be a positive integer",
              code: "INVALID_LIMIT",
            },
          },
          { status: 400 },
        );
      }
      maxStories = parsed;
    }

    const feed = await buildPersonalizedFeed(clientId, {
      forceRefresh,
      maxStories,
    });

    const response = NextResponse.json(feed);
    return attachClientIdCookie(response, clientId, isNew);
  } catch (error) {
    logger.error("GET /api/feed failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    const { statusCode, body } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}
