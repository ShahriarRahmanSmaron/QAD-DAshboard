import {
  getAdminBackendUrl,
  getAdminHeaders,
  proxyBackendResponse,
  unauthorizedResponse,
} from "@/app/api/admin/_utils";

type RouteContext = {
  params: Promise<{ reportId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const headers = await getAdminHeaders();
  if (!headers) {
    return unauthorizedResponse();
  }

  const { reportId } = await context.params;
  const response = await fetch(getAdminBackendUrl(`/api/v1/reports/${reportId}/rows`), {
    method: "POST",
    headers,
    body: JSON.stringify(await request.json()),
    cache: "no-store",
  });

  return proxyBackendResponse(response);
}
