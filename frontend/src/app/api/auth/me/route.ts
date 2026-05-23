import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
} from "@/lib/auth/constants";
import { clearAuthCookies, setAuthCookies } from "@/lib/auth/cookies";
import { getBackendApiUrl } from "@/lib/auth/backend";
import type { AuthSession, CurrentUserResponse } from "@/lib/auth/types";

async function getCurrentUser(accessToken: string) {
  return fetch(`${getBackendApiUrl()}/api/v1/auth/me`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });
}

async function refreshSession(refreshToken: string) {
  return fetch(`${getBackendApiUrl()}/api/v1/auth/refresh`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ refresh_token: refreshToken }),
    cache: "no-store",
  });
}

export async function GET() {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;
  const refreshToken = cookieStore.get(REFRESH_TOKEN_COOKIE)?.value;

  if (accessToken) {
    const userResponse = await getCurrentUser(accessToken).catch(() => null);
    if (userResponse?.ok) {
      const data = (await userResponse.json()) as CurrentUserResponse;
      return NextResponse.json(data);
    }
  }

  if (refreshToken) {
    const refreshResponse = await refreshSession(refreshToken).catch(
      () => null,
    );
    if (refreshResponse?.ok) {
      const session = (await refreshResponse.json()) as AuthSession;
      const response = NextResponse.json({ user: session.user });
      setAuthCookies(response, session);
      return response;
    }
  }

  const response = NextResponse.json(
    { message: "Authentication is required." },
    { status: 401 },
  );
  clearAuthCookies(response);

  return response;
}
