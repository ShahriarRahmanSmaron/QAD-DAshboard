import {
  getAdminBackendUrl,
  getAdminHeaders,
  proxyBackendResponse,
  unauthorizedResponse,
} from "@/app/api/admin/_utils";

type RouteContext = {
  params: Promise<{ reportId: string; action: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const headers = await getAdminHeaders();
  if (!headers) {
    return unauthorizedResponse();
  }

  const { reportId, action } = await context.params;
  const response = await fetch(
    getAdminBackendUrl(`/api/v1/reports/${reportId}/workflow/${action}`),
    {
      method: "POST",
      headers,
      cache: "no-store",
    },
  );

  return proxyBackendResponse(response);
}
