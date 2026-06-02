import { NextResponse, type NextRequest } from "next/server";
import { getBackendApiUrl } from "@/lib/auth/backend";
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
} from "@/lib/auth/constants";
import { clearAuthCookies, setAuthCookies } from "@/lib/auth/cookies";
import type { AuthSession } from "@/lib/auth/types";

const PUBLIC_FILE_PATTERN = /\.(.*)$/;

function isPublicPath(pathname: string) {
  return (
    pathname === "/login" ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    PUBLIC_FILE_PATTERN.test(pathname)
  );
}

async function hasValidAccessToken(accessToken: string) {
  const response = await fetch(`${getBackendApiUrl()}/api/v1/auth/me`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  }).catch(() => null);

  return response?.ok ?? false;
}

async function refreshSession(refreshToken: string) {
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

  return (await response.json()) as AuthSession;
}

function redirectToLogin(request: NextRequest) {
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", request.nextUrl.pathname);
  const response = NextResponse.redirect(loginUrl);
  clearAuthCookies(response);
  return response;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const accessToken = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
  const refreshToken = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value;

  if (pathname !== "/login" && isPublicPath(pathname)) {
    return NextResponse.next();
  }

  if (accessToken && (await hasValidAccessToken(accessToken))) {
    if (pathname === "/login") {
      return NextResponse.redirect(new URL("/", request.url));
    }

    return NextResponse.next();
  }

  if (refreshToken) {
    const session = await refreshSession(refreshToken);
    if (session) {
      const response =
        pathname === "/login"
          ? NextResponse.redirect(new URL("/", request.url))
          : NextResponse.next();
      setAuthCookies(response, session);
      return response;
    }
  }

  if (!isPublicPath(pathname)) {
    return redirectToLogin(request);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
