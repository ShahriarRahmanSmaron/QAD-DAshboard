import { cookies } from "next/headers";
import { getBackendApiUrl } from "@/lib/auth/backend";
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
} from "@/lib/auth/constants";
import type {
  AuthSession,
  AuthUser,
  CurrentUserResponse,
} from "@/lib/auth/types";

async function getUserWithAccessToken(accessToken: string) {
  const response = await fetch(`${getBackendApiUrl()}/api/v1/auth/me`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  }).catch(() => null);

  if (!response?.ok) {
    return null;
  }

  const data = (await response.json()) as CurrentUserResponse;
  return data.user;
}

async function getUserWithRefreshToken(refreshToken: string) {
  const response = await fetch(`${getBackendApiUrl()}/api/v1/auth/refresh`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ refresh_token: refreshToken }),
    cache: "no-store",
  }).catch(() => null);

  if (!response?.ok) {
    return null;
  }

  const session = (await response.json()) as AuthSession;
  return session.user;
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;
  const refreshToken = cookieStore.get(REFRESH_TOKEN_COOKIE)?.value;

  if (accessToken) {
    const user = await getUserWithAccessToken(accessToken);
    if (user) {
      return user;
    }
  }

  if (refreshToken) {
    return getUserWithRefreshToken(refreshToken);
  }

  return null;
}
