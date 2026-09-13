import { NextRequest, NextResponse } from "next/server";
import { migrate } from "@/lib/db/migrate";
import { compareStoryCoverage } from "@/lib/coverage/compare";
import { resolveCoverageStory } from "@/lib/coverage/types";
import { toErrorResponse } from "@/lib/errors";
import { logger } from "@/lib/logger";
import {
  assertRateLimit,
  clientRateLimitKey,
  readJsonWithLimit,
  sanitizeUntrustedText,
} from "@/lib/security";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/coverage/compare — source perspective comparison for one story.
 * Body: { storyId?: string, story?: DailyBriefingStory, topic?: string }
 * Prefers server-stored story by id; validates client story as untrusted fallback.
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
      storyId?: string;
      story?: unknown;
      topic?: string;
    }>(request, { maxBytes: 96 * 1024 });

    const story = resolveCoverageStory({
      storyId: payload.storyId,
      story: payload.story,
    });

    const result = await compareStoryCoverage({
      story,
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
