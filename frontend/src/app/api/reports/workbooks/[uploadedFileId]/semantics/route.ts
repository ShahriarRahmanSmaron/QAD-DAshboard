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

export async function GET(_request: NextRequest, context: RouteContext) {
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
    getAdminBackendUrl(`/api/v1/reports/workbooks/${uploadedFileId}/semantics`),
    {
      headers,
      cache: "no-store",
    },
  );

  return proxyBackendResponse(response);
}
