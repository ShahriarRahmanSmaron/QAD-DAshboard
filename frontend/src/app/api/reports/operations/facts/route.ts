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

  const response = await fetch(
    getAdminBackendUrl(`/api/v1/reports/operations/facts${request.nextUrl.search}`),
    {
      headers,
      cache: "no-store",
    },
  );

  return proxyBackendResponse(response);
}
