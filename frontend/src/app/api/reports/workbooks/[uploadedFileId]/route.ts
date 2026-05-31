import { NextRequest, NextResponse } from "next/server";
import {
  getAdminBackendUrl,
  getAdminHeaders,
  proxyBackendResponse,
  unauthorizedResponse,
} from "@/app/api/admin/_utils";

type RouteContext = {
  params: Promise<{ uploadedFileId: string }>;
};

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const headers = await getAdminHeaders();
  if (!headers) {
    return unauthorizedResponse();
  }

  const { uploadedFileId } = await context.params;
  if (!uploadedFileId) {
    return NextResponse.json(
      { detail: "Uploaded file id is required." },
      { status: 400 },
    );
  }

  const response = await fetch(
    getAdminBackendUrl(`/api/v1/reports/workbooks/${uploadedFileId}`),
    {
      method: "DELETE",
      headers,
      cache: "no-store",
    },
  );

  if (response.status === 204) {
    return new NextResponse(null, { status: 204 });
  }
  return proxyBackendResponse(response);
}
