import { NextRequest, NextResponse } from "next/server";
import { migrate } from "@/lib/db/migrate";
import { toErrorResponse } from "@/lib/errors";
import { logger } from "@/lib/logger";
import {
  attachClientIdCookie,
  ensureClientId,
} from "@/lib/topics/client-id";
import {
  addUserTopic,
  listUserTopics,
  reorderUserTopics,
} from "@/lib/topics/store";
import { isTopicFrequency } from "@/lib/topics/types";

export const runtime = "nodejs";

/**
 * GET /api/topics — list saved topics for this browser.
 * POST /api/topics — add a topic `{ topic, frequency? }`
 * PUT /api/topics — reorder `{ orderedIds: string[] }`
 */
export async function GET(request: NextRequest) {
  try {
    migrate();
    const { clientId, isNew } = ensureClientId(request);
    const topics = listUserTopics(clientId);
    const response = NextResponse.json({ topics });
    return attachClientIdCookie(response, clientId, isNew);
  } catch (error) {
    logger.error("GET /api/topics failed", {
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
    const payload = (await request.json().catch(() => null)) as {
      topic?: string;
      frequency?: string;
    } | null;

    const frequency =
      payload?.frequency && isTopicFrequency(payload.frequency)
        ? payload.frequency
        : undefined;

    const topic = addUserTopic(clientId, {
      topic: payload?.topic ?? "",
      frequency,
    });

    const response = NextResponse.json({ topic }, { status: 201 });
    return attachClientIdCookie(response, clientId, isNew);
  } catch (error) {
    logger.error("POST /api/topics failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    const { statusCode, body } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}

export async function PUT(request: NextRequest) {
  try {
    migrate();
    const { clientId, isNew } = ensureClientId(request);
    const payload = (await request.json().catch(() => null)) as {
      orderedIds?: string[];
    } | null;

    if (!payload?.orderedIds || !Array.isArray(payload.orderedIds)) {
      return NextResponse.json(
        {
          error: {
            message: "Body must include orderedIds: string[]",
            code: "INVALID_REORDER",
          },
        },
        { status: 400 },
      );
    }

    const topics = reorderUserTopics(clientId, payload.orderedIds);
    const response = NextResponse.json({ topics });
    return attachClientIdCookie(response, clientId, isNew);
  } catch (error) {
    logger.error("PUT /api/topics failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    const { statusCode, body } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}
