import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { ingestNewsForTopic } from "@/lib/pipeline/ingest";
import {
  assertRateLimit,
  assertTopicLength,
  clientRateLimitKey,
} from "@/lib/security";

export const runtime = "nodejs";

/**
 * GET /api/news?topic=artificial-intelligence
 * Optional: &refresh=1 to bypass cache
 */
export async function GET(request: NextRequest) {
  try {
    assertRateLimit({
      key: clientRateLimitKey("news", request),
      limit: 40,
      windowMs: 60_000,
    });

    const topic = assertTopicLength(
      request.nextUrl.searchParams.get("topic") ?? "",
    );
    const refresh = request.nextUrl.searchParams.get("refresh");
    const forceRefresh = refresh === "1" || refresh === "true";

    const result = await ingestNewsForTopic(topic, { forceRefresh });

    return NextResponse.json({
      topic: result.topic,
      normalizedTopic: result.normalizedTopic,
      fetchedAt: result.fetchedAt,
      cached: result.cached,
      count: result.count,
      providersUsed: result.providersUsed,
      providersFailed: result.providersFailed,
      articles: result.articles,
    });
  } catch (error) {
    logger.error("GET /api/news failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    const { statusCode, body } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}
