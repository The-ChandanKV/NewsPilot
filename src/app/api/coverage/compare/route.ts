import { NextRequest, NextResponse } from "next/server";
import { migrate } from "@/lib/db/migrate";
import { compareStoryCoverage } from "@/lib/coverage/compare";
import { toErrorResponse } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { DailyBriefingStory } from "@/types/briefing";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/coverage/compare — source perspective comparison for one story.
 * Body: { story: DailyBriefingStory, topic?: string }
 */
export async function POST(request: NextRequest) {
  try {
    migrate();
    const payload = (await request.json().catch(() => ({}))) as {
      story?: DailyBriefingStory;
      topic?: string;
    };

    if (!payload.story) {
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
      topic: payload.topic,
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
