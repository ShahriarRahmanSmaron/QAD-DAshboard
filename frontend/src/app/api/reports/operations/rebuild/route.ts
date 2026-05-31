import {
  getAdminBackendUrl,
  getAdminHeaders,
  proxyBackendResponse,
  unauthorizedResponse,
} from "@/app/api/admin/_utils";

export async function POST() {
  const headers = await getAdminHeaders();
  if (!headers) {
    return unauthorizedResponse();
  }

  const response = await fetch(
    getAdminBackendUrl("/api/v1/reports/operations/rebuild"),
    {
      method: "POST",
      headers,
      cache: "no-store",
    },
  );

  return proxyBackendResponse(response);
}
