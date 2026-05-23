import {
  getAdminBackendUrl,
  getAdminHeaders,
  proxyBackendResponse,
  unauthorizedResponse,
} from "@/app/api/admin/_utils";

export async function GET() {
  const headers = await getAdminHeaders();
  if (!headers) {
    return unauthorizedResponse();
  }

  const response = await fetch(getAdminBackendUrl("/api/v1/admin/roles"), {
    headers,
    cache: "no-store",
  });

  return proxyBackendResponse(response);
}
