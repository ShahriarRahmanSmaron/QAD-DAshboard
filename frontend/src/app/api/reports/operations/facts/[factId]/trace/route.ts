import { NextRequest } from "next/server";
import {
  getAdminBackendUrl,
  getAdminHeaders,
  proxyBackendResponse,
  unauthorizedResponse,
} from "@/app/api/admin/_utils";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ factId: string }> },
) {
  const headers = await getAdminHeaders();
  if (!headers) {
    return unauthorizedResponse();
  }

  const { factId } = await params;
  const response = await fetch(
    getAdminBackendUrl(`/api/v1/reports/operations/facts/${factId}/trace`),
    {
      headers,
      cache: "no-store",
    },
  );

  return proxyBackendResponse(response);
}
