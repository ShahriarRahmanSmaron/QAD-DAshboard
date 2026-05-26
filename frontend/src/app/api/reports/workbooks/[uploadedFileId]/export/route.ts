import { NextRequest, NextResponse } from "next/server";
import {
  getAdminBackendUrl,
  getAdminHeaders,
  unauthorizedResponse,
} from "@/app/api/admin/_utils";

const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

type RouteContext = {
  params: Promise<{ uploadedFileId: string }>;
};

/**
 * Proxy the workbook export endpoint.
 *
 * The backend returns binary XLSX content with custom headers (filename,
 * applied/skipped summary). We must NOT use ``proxyBackendResponse`` here -
 * that helper assumes a JSON body and would corrupt the stream.
 */
export async function POST(request: NextRequest, context: RouteContext) {
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

  const body = await request.text();
  const upstream = await fetch(
    getAdminBackendUrl(`/api/v1/reports/workbooks/${uploadedFileId}/export`),
    {
      method: "POST",
      headers,
      body: body || JSON.stringify({ sheet_edits: {} }),
      cache: "no-store",
    },
  );

  if (!upstream.ok) {
    // Backend will have returned a JSON error envelope.
    let detail = "Workbook export failed.";
    try {
      const data = (await upstream.json()) as { detail?: string; message?: string };
      detail = data.detail ?? data.message ?? detail;
    } catch {
      // fall through
    }
    return NextResponse.json({ detail }, { status: upstream.status });
  }

  const buffer = await upstream.arrayBuffer();
  const responseHeaders = new Headers();
  responseHeaders.set(
    "Content-Type",
    upstream.headers.get("content-type") ?? XLSX_CONTENT_TYPE,
  );
  const disposition = upstream.headers.get("content-disposition");
  if (disposition) {
    responseHeaders.set("Content-Disposition", disposition);
  }
  const summary = upstream.headers.get("x-workbook-export-summary");
  if (summary) {
    responseHeaders.set("X-Workbook-Export-Summary", summary);
  }
  const sourceFilename = upstream.headers.get("x-workbook-source-filename");
  if (sourceFilename) {
    responseHeaders.set("X-Workbook-Source-Filename", sourceFilename);
  }
  responseHeaders.set("Cache-Control", "no-store");

  return new NextResponse(buffer, { status: 200, headers: responseHeaders });
}
