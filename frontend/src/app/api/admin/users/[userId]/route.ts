import { NextRequest } from "next/server";
import {
  getAdminBackendUrl,
  getAdminHeaders,
  proxyBackendResponse,
  unauthorizedResponse,
} from "@/app/api/admin/_utils";

type RouteContext = {
  params: Promise<{
    userId: string;
  }>;
};

export async function PUT(request: NextRequest, context: RouteContext) {
  const headers = await getAdminHeaders();
  if (!headers) {
    return unauthorizedResponse();
  }

  const { userId } = await context.params;
  const response = await fetch(getAdminBackendUrl(`/api/v1/admin/users/${userId}`), {
    method: "PUT",
    headers,
    body: JSON.stringify(await request.json()),
    cache: "no-store",
  });

  return proxyBackendResponse(response);
}
