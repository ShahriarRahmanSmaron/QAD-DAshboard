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
  if (!text) {
    return NextResponse.json({ ok: response.ok }, { status: response.status });
  }
  try {
    return NextResponse.json(JSON.parse(text), { status: response.status });
  } catch {
    // Backend returned a non-JSON body (e.g. a plain "Internal Server Error"
    // or a gateway timeout page). Surface it as a structured error instead of
    // throwing a JSON parse error that masks the real status.
    return NextResponse.json(
      { detail: text.slice(0, 500) },
      { status: response.status },
    );
  }
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
