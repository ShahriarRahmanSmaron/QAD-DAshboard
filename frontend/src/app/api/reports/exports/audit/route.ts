import { NextRequest } from "next/server";
import {
  getAdminBackendUrl,
  getAdminHeaders,
  proxyBackendResponse,
  unauthorizedResponse,
} from "@/app/api/admin/_utils";

export async function POST(request: NextRequest) {
  const headers = await getAdminHeaders();
  if (!headers) {
    return unauthorizedResponse();
  }

  const response = await fetch(getAdminBackendUrl("/api/v1/reports/exports/audit"), {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(await request.json()),
    cache: "no-store",
  });

  return proxyBackendResponse(response);
}
