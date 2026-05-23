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
    getAdminBackendUrl(`/api/v1/buyers${queryString ? `?${queryString}` : ""}`),
    {
      headers,
      cache: "no-store",
    },
  );

  return proxyBackendResponse(response);
}
