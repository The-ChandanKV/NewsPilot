import { randomUUID } from "crypto";
import type { NextRequest, NextResponse } from "next/server";

export const CLIENT_ID_COOKIE = "np_client_id";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export function readClientId(request: NextRequest): string | null {
  const value = request.cookies.get(CLIENT_ID_COOKIE)?.value?.trim();
  return value || null;
}

export function ensureClientId(request: NextRequest): {
  clientId: string;
  isNew: boolean;
} {
  const existing = readClientId(request);
  if (existing) {
    return { clientId: existing, isNew: false };
  }
  return { clientId: randomUUID(), isNew: true };
}

export function attachClientIdCookie(
  response: NextResponse,
  clientId: string,
  isNew: boolean,
): NextResponse {
  if (!isNew) {
    return response;
  }
  response.cookies.set({
    name: CLIENT_ID_COOKIE,
    value: clientId,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
  });
  return response;
}
