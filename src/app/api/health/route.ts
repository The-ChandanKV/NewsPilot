import { NextResponse } from "next/server";
import { getEnv } from "@/config/env";
import { checkDatabaseConnection } from "@/lib/db/client";
import { migrate } from "@/lib/db/migrate";
import { toErrorResponse } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { getAiProviderStatus } from "@/lib/providers/llm/router";
import { getNewsProviderStatus } from "@/lib/providers/news/aggregator";
import type { HealthStatus } from "@/types/briefing";

export const runtime = "nodejs";

export async function GET() {
  try {
    migrate();

    const database = checkDatabaseConnection();
    const ai = getAiProviderStatus();
    const news = getNewsProviderStatus();
    const env = getEnv();

    const status: HealthStatus["status"] = database.connected ? "ok" : "degraded";

    const payload: HealthStatus = {
      status,
      app: env.APP_NAME,
      timestamp: new Date().toISOString(),
      database,
      ai,
      news,
    };

    logger.info("Health check completed", {
      status: payload.status,
      databaseConnected: database.connected,
      aiProvider: ai.selectedProvider,
      newsProviders: news.enabledProviders,
    });

    return NextResponse.json(payload, {
      status: database.connected ? 200 : 503,
    });
  } catch (error) {
    logger.error("Health check failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    const { statusCode, body } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}
