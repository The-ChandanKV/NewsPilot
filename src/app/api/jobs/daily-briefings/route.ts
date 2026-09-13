import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/config/env";
import { migrate } from "@/lib/db/migrate";
import { toErrorResponse } from "@/lib/errors";
import { logger } from "@/lib/logger";
import {
  listStoredDailyBriefings,
  requireJobSecret,
} from "@/lib/jobs/daily-briefing-store";
import {
  getDailyBriefingScheduleConfig,
  runDailyBriefingsJob,
} from "@/lib/jobs/daily-briefings";
import { runEmailDeliveryJob } from "@/lib/notifications/delivery";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * GET /api/jobs/daily-briefings — schedule config + stored briefings for a date.
 * POST /api/jobs/daily-briefings — run the idempotent daily job.
 * Optional header: x-daily-job-secret
 */
export async function GET(request: NextRequest) {
  try {
    migrate();
    const date = request.nextUrl.searchParams.get("date") ?? undefined;
    const briefings = listStoredDailyBriefings({ date, limit: 50 });
    return NextResponse.json({
      schedule: getDailyBriefingScheduleConfig(),
      date: date ?? null,
      briefings,
    });
  } catch (error) {
    logger.error("GET /api/jobs/daily-briefings failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    const { statusCode, body } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}

export async function POST(request: NextRequest) {
  try {
    migrate();
    const env = getEnv();
    const secret =
      request.headers.get("x-daily-job-secret") ??
      request.nextUrl.searchParams.get("secret");
    requireJobSecret(secret, env.DAILY_JOB_SECRET);

    const payload = (await request.json().catch(() => ({}))) as {
      date?: string;
      force?: boolean;
      topics?: string[];
      skipEmail?: boolean;
    };

    const result = await runDailyBriefingsJob({
      date: payload.date,
      force: Boolean(payload.force),
      topics: payload.topics,
    });

    let emailDelivery = null;
    if (
      env.EMAIL_DELIVERY_AFTER_BRIEFINGS &&
      result.status !== "failed" &&
      !payload.skipEmail
    ) {
      emailDelivery = await runEmailDeliveryJob({
        date: result.date,
        ignoreSchedule: Boolean(payload.force),
      });
    }

    return NextResponse.json(
      { ...result, emailDelivery },
      {
        status: result.status === "failed" ? 500 : 200,
      },
    );
  } catch (error) {
    logger.error("POST /api/jobs/daily-briefings failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    const { statusCode, body } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}
