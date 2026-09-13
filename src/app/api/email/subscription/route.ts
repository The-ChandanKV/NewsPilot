import { NextRequest, NextResponse } from "next/server";
import { migrate } from "@/lib/db/migrate";
import { toErrorResponse } from "@/lib/errors";
import { logger } from "@/lib/logger";
import {
  attachClientIdCookie,
  ensureClientId,
} from "@/lib/topics/client-id";
import {
  getEmailSubscriptionForClient,
  listEmailDeliveries,
  unsubscribeForClient,
  upsertEmailSubscription,
} from "@/lib/notifications/subscription-store";

export const runtime = "nodejs";

/**
 * GET /api/email/subscription — current client's email prefs + recent deliveries
 * POST /api/email/subscription — create/update subscription
 * DELETE /api/email/subscription — unsubscribe this client
 */
export async function GET(request: NextRequest) {
  try {
    migrate();
    const { clientId, isNew } = ensureClientId(request);
    const subscription = getEmailSubscriptionForClient(clientId);
    const deliveries = subscription
      ? listEmailDeliveries({ subscriptionId: subscription.id, limit: 20 })
      : [];
    const response = NextResponse.json({ subscription, deliveries });
    return attachClientIdCookie(response, clientId, isNew);
  } catch (error) {
    logger.error("GET /api/email/subscription failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    const { statusCode, body } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}

export async function POST(request: NextRequest) {
  try {
    migrate();
    const { clientId, isNew } = ensureClientId(request);
    const payload = (await request.json().catch(() => ({}))) as {
      email?: string;
      timezone?: string;
      deliveryHour?: number;
      deliveryMinute?: number;
      topics?: string[];
      active?: boolean;
    };

    if (!payload.email || typeof payload.email !== "string") {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_EMAIL",
            message: "email is required",
          },
        },
        { status: 400 },
      );
    }

    const subscription = upsertEmailSubscription(clientId, {
      email: payload.email,
      timezone: payload.timezone,
      deliveryHour: payload.deliveryHour,
      deliveryMinute: payload.deliveryMinute,
      topics: payload.topics,
      active: payload.active,
    });

    const response = NextResponse.json({ subscription });
    return attachClientIdCookie(response, clientId, isNew);
  } catch (error) {
    logger.error("POST /api/email/subscription failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    const { statusCode, body } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    migrate();
    const { clientId, isNew } = ensureClientId(request);
    const subscription = unsubscribeForClient(clientId);
    const response = NextResponse.json({
      subscription,
      unsubscribed: Boolean(subscription),
    });
    return attachClientIdCookie(response, clientId, isNew);
  } catch (error) {
    logger.error("DELETE /api/email/subscription failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    const { statusCode, body } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}
