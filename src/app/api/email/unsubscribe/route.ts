import { NextRequest, NextResponse } from "next/server";
import { migrate } from "@/lib/db/migrate";
import { toErrorResponse } from "@/lib/errors";
import { logger } from "@/lib/logger";
import {
  getEmailSubscriptionByToken,
  unsubscribeByToken,
} from "@/lib/notifications/subscription-store";

export const runtime = "nodejs";

/**
 * GET /api/email/unsubscribe?token=… — confirm page / status
 * POST /api/email/unsubscribe — body or query token to unsubscribe
 */
export async function GET(request: NextRequest) {
  try {
    migrate();
    const token = request.nextUrl.searchParams.get("token");
    if (!token) {
      return NextResponse.json(
        {
          error: {
            code: "MISSING_TOKEN",
            message: "token is required",
          },
        },
        { status: 400 },
      );
    }

    const subscription = getEmailSubscriptionByToken(token);
    if (!subscription) {
      return NextResponse.json(
        {
          error: {
            code: "UNSUBSCRIBE_NOT_FOUND",
            message: "Unsubscribe link is invalid or expired",
          },
        },
        { status: 404 },
      );
    }

    // One-click unsubscribe via GET (List-Unsubscribe compatible).
    if (request.nextUrl.searchParams.get("confirm") === "1" || subscription.active) {
      const updated = unsubscribeByToken(token);
      return new NextResponse(
        `<!doctype html><html><body style="font-family:Georgia,serif;padding:2rem">
          <h1>Unsubscribed</h1>
          <p>${updated.email} will no longer receive NewsPilot daily briefing emails.</p>
        </body></html>`,
        {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        },
      );
    }

    return NextResponse.json({
      email: subscription.email,
      active: subscription.active,
    });
  } catch (error) {
    logger.error("GET /api/email/unsubscribe failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    const { statusCode, body } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}

export async function POST(request: NextRequest) {
  try {
    migrate();
    const payload = (await request.json().catch(() => ({}))) as { token?: string };
    const token =
      payload.token ?? request.nextUrl.searchParams.get("token") ?? undefined;
    if (!token) {
      return NextResponse.json(
        {
          error: {
            code: "MISSING_TOKEN",
            message: "token is required",
          },
        },
        { status: 400 },
      );
    }

    const subscription = unsubscribeByToken(token);
    return NextResponse.json({
      unsubscribed: true,
      email: subscription.email,
    });
  } catch (error) {
    logger.error("POST /api/email/unsubscribe failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    const { statusCode, body } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}
