import { NextRequest, NextResponse } from "next/server";
import {
  getAdminBackendUrl,
  getAdminHeaders,
  unauthorizedResponse,
} from "@/app/api/admin/_utils";

export async function GET(request: NextRequest) {
  const headers = await getAdminHeaders();
  if (!headers) {
    return unauthorizedResponse();
  }

  const response = await fetch(
    getAdminBackendUrl(`/api/v1/charts/time-series/export.xlsx${request.nextUrl.search}`),
    {
      headers,
      cache: "no-store",
    },
  );

  const body = await response.arrayBuffer();
  return new NextResponse(body, {
    status: response.status,
    headers: {
      "Content-Type":
        response.headers.get("Content-Type") ??
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition":
        response.headers.get("Content-Disposition") ?? 'attachment; filename="trend.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
