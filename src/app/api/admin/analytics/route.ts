import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/config/env";
import { computePipelineAnalytics } from "@/lib/analytics/compute";
import { migrate } from "@/lib/db/migrate";
import { AppError, toErrorResponse } from "@/lib/errors";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

function requireAnalyticsAccess(request: NextRequest): void {
  const env = getEnv();
  const expected = env.ADMIN_ANALYTICS_SECRET ?? env.DAILY_JOB_SECRET;
  const provided =
    request.headers.get("x-admin-secret") ??
    request.nextUrl.searchParams.get("secret");

  if (!expected) {
    if (env.NODE_ENV === "production") {
      throw new AppError("Analytics admin secret is not configured", {
        statusCode: 503,
        code: "ADMIN_SECRET_REQUIRED",
      });
    }
    return;
  }

  if (!provided || provided !== expected) {
    throw new AppError("Unauthorized analytics request", {
      statusCode: 401,
      code: "UNAUTHORIZED_ANALYTICS",
    });
  }
}

/**
 * GET /api/admin/analytics?days=14
 * Internal pipeline metrics — no API keys or personal data.
 */
export async function GET(request: NextRequest) {
  try {
    migrate();
    requireAnalyticsAccess(request);

    const daysParam = request.nextUrl.searchParams.get("days");
    const days = daysParam ? Number(daysParam) : 14;
    const snapshot = computePipelineAnalytics({
      days: Number.isFinite(days) ? days : 14,
    });

    return NextResponse.json(snapshot);
  } catch (error) {
    logger.error("GET /api/admin/analytics failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    const { statusCode, body } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}
