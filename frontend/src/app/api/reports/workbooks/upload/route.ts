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

  const response = await fetch(getAdminBackendUrl("/api/v1/reports/workbooks/upload"), {
    method: "POST",
    headers: {
      Authorization: headers.Authorization,
    },
    body: await request.formData(),
    cache: "no-store",
  });

  return proxyBackendResponse(response);
}
