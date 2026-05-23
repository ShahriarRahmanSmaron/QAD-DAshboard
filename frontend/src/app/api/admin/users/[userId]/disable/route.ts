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

export async function POST(_request: Request, context: RouteContext) {
  const headers = await getAdminHeaders();
  if (!headers) {
    return unauthorizedResponse();
  }

  const { userId } = await context.params;
  const response = await fetch(
    getAdminBackendUrl(`/api/v1/admin/users/${userId}/disable`),
    {
      method: "POST",
      headers,
      cache: "no-store",
    },
  );

  return proxyBackendResponse(response);
}
