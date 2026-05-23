import { NextRequest } from "next/server";
import {
  getAdminBackendUrl,
  getAdminHeaders,
  proxyBackendResponse,
  unauthorizedResponse,
} from "@/app/api/admin/_utils";

export async function GET(request: NextRequest) {
  const headers = await getAdminHeaders();
  if (!headers) {
    return unauthorizedResponse();
  }

  const queryString = request.nextUrl.searchParams.toString();
  const response = await fetch(
    getAdminBackendUrl(`/api/v1/admin/users${queryString ? `?${queryString}` : ""}`),
    {
      headers,
      cache: "no-store",
    },
  );

  return proxyBackendResponse(response);
}

export async function POST(request: NextRequest) {
  const headers = await getAdminHeaders();
  if (!headers) {
    return unauthorizedResponse();
  }

  const response = await fetch(getAdminBackendUrl("/api/v1/admin/users"), {
    method: "POST",
    headers,
    body: JSON.stringify(await request.json()),
    cache: "no-store",
  });

  return proxyBackendResponse(response);
}
