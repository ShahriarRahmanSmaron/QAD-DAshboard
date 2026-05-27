import type {
  BulkReportSavePayload,
  BuyerListResponse,
  OperationalFactListResponse,
  OperationalSummaryResponse,
  Report,
  ReportCreatePayload,
  ReportListResponse,
  ReportMetric,
  ReportMetricCreatePayload,
  ReportRow,
  ReportRowCreatePayload,
  ReportSummaryListResponse,
  ReportWorkflowAction,
  ReportTypeListResponse,
  UnitListResponse,
  WorkbookSemanticBreakdownResponse,
  WorkbookUploadResponse,
} from "@/lib/reports/types";

type ApiErrorBody = {
  detail?: string;
  message?: string;
};

async function request<TResponse>(
  path: string,
  options: Omit<RequestInit, "body"> & { body?: unknown } = {},
) {
  const { body, headers, ...init } = options;
  const response = await fetch(path, {
    ...init,
    body: body ? JSON.stringify(body) : undefined,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });

  if (!response.ok) {
    let message = "Request failed.";
    try {
      const data = (await response.json()) as ApiErrorBody;
      message = data.detail ?? data.message ?? message;
    } catch {
      message = `Request failed with status ${response.status}.`;
    }
    throw new Error(message);
  }

  return response.json() as Promise<TResponse>;
}

export function listReports(page = 1, pageSize = 10) {
  const params = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  });
  return request<ReportListResponse>(`/api/reports?${params}`);
}

export function getReport(reportId: string) {
  return request<Report>(`/api/reports/${reportId}`);
}

export function createReport(payload: ReportCreatePayload) {
  return request<Report>("/api/reports", {
    method: "POST",
    body: payload,
  });
}

export function createReportRow(reportId: string, payload: ReportRowCreatePayload) {
  return request<ReportRow>(`/api/reports/${reportId}/rows`, {
    method: "POST",
    body: payload,
  });
}

export function createReportMetric(reportId: string, payload: ReportMetricCreatePayload) {
  return request<ReportMetric>(`/api/reports/${reportId}/metrics`, {
    method: "POST",
    body: payload,
  });
}

export function bulkSaveReport(payload: BulkReportSavePayload) {
  return request<Report>("/api/reports/save", {
    method: "POST",
    body: payload,
  });
}

export function transitionReportWorkflow(reportId: string, action: ReportWorkflowAction) {
  return request<Report>(`/api/reports/${reportId}/workflow/${action}`, {
    method: "POST",
  });
}

export function listReportSummaries(page = 1, pageSize = 20) {
  const params = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  });
  return request<ReportSummaryListResponse>(`/api/reports/summaries?${params}`);
}

export function listBuyers() {
  return request<BuyerListResponse>("/api/buyers");
}

export function listUnits() {
  return request<UnitListResponse>("/api/units");
}

export function listReportTypes() {
  return request<ReportTypeListResponse>("/api/report-types");
}

export type OperationalQueryParams = {
  uploaded_file_id?: string;
  buyer?: string;
  unit?: string;
  metric?: string;
  report_date?: string;
  page?: number;
  page_size?: number;
};

function operationalParams(params: OperationalQueryParams = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    query.set(key, String(value));
  }
  return query.toString();
}

export function listOperationalFacts(params: OperationalQueryParams = {}) {
  const query = operationalParams(params);
  return request<OperationalFactListResponse>(
    `/api/reports/operations/facts${query ? `?${query}` : ""}`,
  );
}

export function listOperationalFactsByBuyer(
  buyer: string,
  params: Omit<OperationalQueryParams, "buyer"> = {},
) {
  return listOperationalFacts({ ...params, buyer });
}

export function listOperationalFactsByUnit(
  unit: string,
  params: Omit<OperationalQueryParams, "unit"> = {},
) {
  return listOperationalFacts({ ...params, unit });
}

export function listOperationalMetricHistory(
  metric: string,
  params: Omit<OperationalQueryParams, "metric"> = {},
) {
  return listOperationalFacts({ ...params, metric });
}

export function getOperationalSummary(
  params: Omit<OperationalQueryParams, "page" | "page_size"> = {},
) {
  const query = operationalParams(params);
  return request<OperationalSummaryResponse>(
    `/api/reports/operations/summary${query ? `?${query}` : ""}`,
  );
}

export function getWorkbookSemantics(uploadedFileId: string) {
  return request<WorkbookSemanticBreakdownResponse>(
    `/api/reports/workbooks/${uploadedFileId}/semantics`,
  );
}

export function uploadWorkbook(
  file: File,
  onProgress?: (progress: number) => void,
): Promise<WorkbookUploadResponse> {
  const formData = new FormData();
  formData.append("file", file);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/reports/workbooks/upload");
    xhr.responseType = "json";

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress?.(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      const response = xhr.response as WorkbookUploadResponse | ApiErrorBody | null;
      if (xhr.status >= 200 && xhr.status < 300 && response) {
        onProgress?.(100);
        resolve(response as WorkbookUploadResponse);
        return;
      }

      const errorBody = response as ApiErrorBody | null;
      reject(new Error(errorBody?.detail ?? errorBody?.message ?? "Workbook upload failed."));
    };

    xhr.onerror = () => reject(new Error("Workbook upload failed."));
    xhr.send(formData);
  });
}

export type WorkbookExportPayload = {
  sheet_edits: Record<string, Record<string, string | number | boolean | null>>;
};

export type WorkbookExportResult = {
  blob: Blob;
  filename: string;
  summary: string | null;
};

const exportFilenameRegex = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i;

function parseExportFilename(disposition: string | null, fallback: string) {
  if (!disposition) {
    return fallback;
  }
  const match = exportFilenameRegex.exec(disposition);
  if (!match || !match[1]) {
    return fallback;
  }
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

/**
 * Reconstruct an XLSX export with operational edits applied.
 *
 * Returns the binary ``Blob`` plus the suggested download filename. The
 * caller decides how to present the download - either by triggering a
 * browser save (see ``triggerWorkbookDownload``) or by reading the buffer
 * for further processing.
 */
export async function exportWorkbook(
  uploadedFileId: string,
  payload: WorkbookExportPayload,
): Promise<WorkbookExportResult> {
  const response = await fetch(
    `/api/reports/workbooks/${uploadedFileId}/export`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    let message = "Workbook export failed.";
    try {
      const data = (await response.json()) as ApiErrorBody;
      message = data.detail ?? data.message ?? message;
    } catch {
      message = `Workbook export failed with status ${response.status}.`;
    }
    throw new Error(message);
  }

  const blob = await response.blob();
  const filename = parseExportFilename(
    response.headers.get("Content-Disposition"),
    "workbook-edited.xlsx",
  );
  const summary = response.headers.get("X-Workbook-Export-Summary");
  return { blob, filename, summary };
}

/**
 * Trigger a browser download for an exported workbook blob.
 */
export function triggerWorkbookDownload(blob: Blob, filename: string) {
  if (typeof window === "undefined") {
    return;
  }
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Defer revoke so the browser has time to start the download in all cases.
  window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
}
