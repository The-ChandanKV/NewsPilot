import { NextRequest, NextResponse } from "next/server";
import { migrate } from "@/lib/db/migrate";
import { toErrorResponse } from "@/lib/errors";
import { logger } from "@/lib/logger";
import {
  getStoredDailyBriefing,
  getStoredDailyBriefingById,
  listStoredDailyBriefings,
} from "@/lib/jobs/daily-briefing-store";
import { briefingDateForNow } from "@/lib/jobs/daily-briefings";

export const runtime = "nodejs";

/**
 * GET /api/daily-briefings?date=YYYY-MM-DD
 * GET /api/daily-briefings?id=...
 * GET /api/daily-briefings?topic=AI&date=YYYY-MM-DD
 */
export async function GET(request: NextRequest) {
  try {
    migrate();
    const id = request.nextUrl.searchParams.get("id");
    const topic = request.nextUrl.searchParams.get("topic");
    const date =
      request.nextUrl.searchParams.get("date") ?? briefingDateForNow();

    if (id) {
      const briefing = getStoredDailyBriefingById(id);
      if (!briefing) {
        return NextResponse.json(
          {
            error: {
              message: "Daily briefing not found",
              code: "DAILY_BRIEFING_NOT_FOUND",
            },
          },
          { status: 404 },
        );
      }
      return NextResponse.json({ briefing });
    }

    if (topic) {
      const briefing = getStoredDailyBriefing(topic, date);
      if (!briefing) {
        return NextResponse.json(
          {
            error: {
              message: "Daily briefing not found for topic/date",
              code: "DAILY_BRIEFING_NOT_FOUND",
            },
          },
          { status: 404 },
        );
      }
      return NextResponse.json({ briefing });
    }

    const briefings = listStoredDailyBriefings({ date, limit: 50 });
    return NextResponse.json({ date, briefings });
  } catch (error) {
    logger.error("GET /api/daily-briefings failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    const { statusCode, body } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}
