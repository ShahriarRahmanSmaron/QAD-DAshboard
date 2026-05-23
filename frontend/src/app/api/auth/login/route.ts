import { NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/auth/cookies";
import { getBackendApiUrl } from "@/lib/auth/backend";
import type { AuthSession } from "@/lib/auth/types";

type BackendError = {
  detail?: string;
  message?: string;
};

async function getErrorMessage(response: Response) {
  try {
    const data = (await response.json()) as BackendError;
    return data.detail ?? data.message ?? "Unable to sign in.";
  } catch {
    return "Unable to sign in.";
  }
}

export async function POST(request: Request) {
  const payload = await request.json();

  let backendResponse: Response;
  try {
    backendResponse = await fetch(`${getBackendApiUrl()}/api/v1/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json(
      { message: "Authentication service is unavailable." },
      { status: 502 },
    );
  }

  if (!backendResponse.ok) {
    return NextResponse.json(
      { message: await getErrorMessage(backendResponse) },
      { status: backendResponse.status },
    );
  }

  const session = (await backendResponse.json()) as AuthSession;
  const response = NextResponse.json({ user: session.user });
  setAuthCookies(response, session);

  return response;
}
