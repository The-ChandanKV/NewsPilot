import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { processNewsForTopic } from "@/lib/pipeline/process";

export const runtime = "nodejs";

/**
 * GET /api/stories?topic=artificial-intelligence
 * Runs ingestion + deterministic processing (no LLM summarization).
 * Optional: &refresh=1 to bypass news fetch cache
 */
export async function GET(request: NextRequest) {
  try {
    const topic = request.nextUrl.searchParams.get("topic") ?? "";
    const refresh = request.nextUrl.searchParams.get("refresh");
    const forceRefresh = refresh === "1" || refresh === "true";

    const result = await processNewsForTopic(topic, { forceRefresh });

    return NextResponse.json({
      topic: result.topic,
      normalizedTopic: result.normalizedTopic,
      fetchedAt: result.fetchedAt,
      processedAt: result.processedAt,
      cached: result.cached,
      inputCount: result.inputCount,
      afterUrlDedupe: result.afterUrlDedupe,
      afterNearDedupe: result.afterNearDedupe,
      storyCount: result.storyCount,
      providersUsed: result.providersUsed,
      providersFailed: result.providersFailed,
      stories: result.stories,
    });
  } catch (error) {
    logger.error("GET /api/stories failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    const { statusCode, body } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}
