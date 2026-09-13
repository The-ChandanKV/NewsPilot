import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { buildBriefingForTopic } from "@/lib/pipeline/briefing";
import {
  assertRateLimit,
  assertTopicLength,
  clientRateLimitKey,
} from "@/lib/security";

export const runtime = "nodejs";

/**
 * GET /api/briefing?topic=artificial-intelligence
 *
 * Daily news briefing for a topic.
 * Optional query params:
 * - refresh=1 — bypass briefing + news caches (still reuses valid AI summaries)
 * - refreshAi=1 — also bypass AI summary caches (expensive)
 * - limit=N — max stories (capped by server config)
 */
export async function GET(request: NextRequest) {
  try {
    assertRateLimit({
      key: clientRateLimitKey("briefing", request),
      limit: 30,
      windowMs: 60_000,
    });

    const topic = assertTopicLength(
      request.nextUrl.searchParams.get("topic") ?? "",
    );
    const refresh = request.nextUrl.searchParams.get("refresh");
    const refreshAi = request.nextUrl.searchParams.get("refreshAi");
    const limitRaw = request.nextUrl.searchParams.get("limit");
    const forceRefresh = refresh === "1" || refresh === "true";
    const forceAiRefresh = refreshAi === "1" || refreshAi === "true";

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
      maxStories = Math.min(parsed, 30);
    }

    const briefing = await buildBriefingForTopic(topic, {
      forceRefresh,
      forceAiRefresh,
      maxStories,
    });

    return NextResponse.json({
      topic: briefing.topic,
      generatedAt: briefing.generatedAt,
      timeRange: briefing.timeRange,
      totalStories: briefing.totalStories,
      cached: briefing.cached,
      llmCalls: briefing.llmCalls,
      summaryCacheHits: briefing.summaryCacheHits,
      providerUsed: briefing.providerUsed,
      warnings: briefing.warnings,
      whatsNew: briefing.whatsNew,
      stories: briefing.stories,
    });
  } catch (error) {
    logger.error("GET /api/briefing failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    const { statusCode, body } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}
