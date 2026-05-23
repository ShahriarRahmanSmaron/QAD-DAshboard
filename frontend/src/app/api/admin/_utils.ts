import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ACCESS_TOKEN_COOKIE } from "@/lib/auth/constants";
import { getBackendApiUrl } from "@/lib/auth/backend";

type BackendError = {
  detail?: string;
  message?: string;
};

export async function getAdminHeaders() {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;

  if (!accessToken) {
    return null;
  }

  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
}

export async function proxyBackendResponse(response: Response) {
  const text = await response.text();
  const body = text ? JSON.parse(text) : { ok: response.ok };
  return NextResponse.json(body, { status: response.status });
}

export async function getBackendError(response: Response) {
  try {
    const data = (await response.json()) as BackendError;
    return data.detail ?? data.message ?? "Request failed.";
  } catch {
    return "Request failed.";
  }
}

export function getAdminBackendUrl(path: string) {
  return `${getBackendApiUrl()}${path}`;
}

export function unauthorizedResponse() {
  return NextResponse.json(
    { message: "Authentication is required." },
    { status: 401 },
  );
}
