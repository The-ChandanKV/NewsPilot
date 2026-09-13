import { NextRequest, NextResponse } from "next/server";
import { migrate } from "@/lib/db/migrate";
import { toErrorResponse } from "@/lib/errors";
import { logger } from "@/lib/logger";
import {
  attachClientIdCookie,
  ensureClientId,
} from "@/lib/topics/client-id";
import {
  removeUserTopic,
  renameUserTopic,
  setTopicFrequency,
} from "@/lib/topics/store";
import { isTopicFrequency } from "@/lib/topics/types";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * PATCH /api/topics/:id — rename and/or set frequency
 * DELETE /api/topics/:id — remove topic
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    migrate();
    const { id } = await context.params;
    const { clientId, isNew } = ensureClientId(request);
    const payload = (await request.json().catch(() => null)) as {
      topic?: string;
      frequency?: string;
    } | null;

    let topic = null as ReturnType<typeof renameUserTopic> | null;

    if (typeof payload?.topic === "string") {
      topic = renameUserTopic(clientId, id, payload.topic);
    }

    if (typeof payload?.frequency === "string") {
      if (!isTopicFrequency(payload.frequency)) {
        return NextResponse.json(
          {
            error: {
              message: "frequency must be daily, twice_daily, or weekly",
              code: "INVALID_FREQUENCY",
            },
          },
          { status: 400 },
        );
      }
      topic = setTopicFrequency(clientId, id, payload.frequency);
    }

    if (!topic) {
      return NextResponse.json(
        {
          error: {
            message: "Provide topic and/or frequency to update",
            code: "INVALID_UPDATE",
          },
        },
        { status: 400 },
      );
    }

    const response = NextResponse.json({ topic });
    return attachClientIdCookie(response, clientId, isNew);
  } catch (error) {
    logger.error("PATCH /api/topics/[id] failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    const { statusCode, body } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    migrate();
    const { id } = await context.params;
    const { clientId, isNew } = ensureClientId(request);
    removeUserTopic(clientId, id);
    const response = NextResponse.json({ ok: true });
    return attachClientIdCookie(response, clientId, isNew);
  } catch (error) {
    logger.error("DELETE /api/topics/[id] failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    const { statusCode, body } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}
