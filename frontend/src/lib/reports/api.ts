import type {
  BulkReportSavePayload,
  BuyerListResponse,
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
