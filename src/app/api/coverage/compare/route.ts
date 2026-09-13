import { NextRequest, NextResponse } from "next/server";
import { migrate } from "@/lib/db/migrate";
import { compareStoryCoverage } from "@/lib/coverage/compare";
import { toErrorResponse } from "@/lib/errors";
import { logger } from "@/lib/logger";
import {
  assertRateLimit,
  clientRateLimitKey,
  readJsonWithLimit,
  sanitizeUntrustedText,
} from "@/lib/security";
import type { DailyBriefingStory } from "@/types/briefing";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/coverage/compare — source perspective comparison for one story.
 * Body: { story: DailyBriefingStory, topic?: string }
 * AI runs server-side only; body size + rate limited.
 */
export async function POST(request: NextRequest) {
  try {
    migrate();
    assertRateLimit({
      key: clientRateLimitKey("coverage-compare", request),
      limit: 15,
      windowMs: 60_000,
    });

    const payload = await readJsonWithLimit<{
      story?: DailyBriefingStory;
      topic?: string;
    }>(request, { maxBytes: 96 * 1024 });

    if (!payload.story || typeof payload.story !== "object") {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_STORY",
            message: "story is required",
          },
        },
        { status: 400 },
      );
    }

    const result = await compareStoryCoverage({
      story: payload.story,
      topic: payload.topic
        ? sanitizeUntrustedText(payload.topic, { maxLength: 120 })
        : undefined,
    });

    return NextResponse.json(result);
  } catch (error) {
    logger.error("POST /api/coverage/compare failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    const { statusCode, body } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}
