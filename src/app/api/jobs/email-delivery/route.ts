import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/config/env";
import { migrate } from "@/lib/db/migrate";
import { toErrorResponse } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { requireJobSecret } from "@/lib/jobs/daily-briefing-store";
import { runEmailDeliveryJob } from "@/lib/notifications/delivery";
import { getNotificationProvider } from "@/lib/notifications/router";
import { listEmailDeliveries } from "@/lib/notifications/subscription-store";
import { readJsonWithLimit } from "@/lib/security";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * GET /api/jobs/email-delivery — recent delivery log + provider status
 * POST /api/jobs/email-delivery — send emails from stored DailyBriefings
 * Auth: x-daily-job-secret (required in production).
 */
export async function GET(request: NextRequest) {
  try {
    migrate();
    const env = getEnv();
    const secret =
      request.headers.get("x-daily-job-secret") ??
      request.nextUrl.searchParams.get("secret");
    requireJobSecret(secret, env.DAILY_JOB_SECRET);

    const provider = getNotificationProvider();
    return NextResponse.json({
      provider: {
        name: provider.name,
        configured: provider.isConfigured(),
      },
      deliveries: listEmailDeliveries({ limit: 50 }),
    });
  } catch (error) {
    logger.error("GET /api/jobs/email-delivery failed", {
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

    const payload = await readJsonWithLimit<{
      date?: string;
      ignoreSchedule?: boolean;
      forceResend?: boolean;
    }>(request, { maxBytes: 16 * 1024 });

    const result = await runEmailDeliveryJob({
      date: payload.date,
      ignoreSchedule: Boolean(payload.ignoreSchedule),
      forceResend: Boolean(payload.forceResend),
    });

    return NextResponse.json(result);
  } catch (error) {
    logger.error("POST /api/jobs/email-delivery failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    const { statusCode, body } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}
