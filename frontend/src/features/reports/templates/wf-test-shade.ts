import type { ReportTemplate } from "@/features/reports/templates/types";

export const wfTestShadeTemplate: ReportTemplate = {
  id: "wf-test-shade",
  name: "WF Test & Shade",
  description: "Operational wet finishing test and shade reporting layout.",
  operationalLabel: "Wet finishing / shade control",
  match: (report) => {
    const haystack = [
      report.report_type_name,
      report.title,
      typeof report.metadata.template === "string" ? report.metadata.template : null,
      typeof report.metadata.excel_template_key === "string" ? report.metadata.excel_template_key : null,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return (
      haystack.includes("wf") ||
      haystack.includes("wet finishing") ||
      haystack.includes("shade")
    );
  },
  baseColumns: [
    { field: "row_label", headerName: "Buyer / Lot", minWidth: 210, pinned: "left" },
    { field: "row_group", headerName: "Section", minWidth: 150 },
    { field: "row_key", headerName: "Operational key", minWidth: 160 },
  ],
  sections: [
    {
      id: "buyer_shade",
      label: "Buyer-wise shade review",
      rowGroup: "buyer_shade",
      description: "Shade continuity and approval observations by buyer or lot.",
      allowDynamicRows: true,
    },
    {
      id: "wet_finish",
      label: "Wet finishing test",
      rowGroup: "wet_finish",
      description: "Core wet finishing test measurements.",
      allowDynamicRows: true,
    },
    {
      id: "approval",
      label: "Approval and remarks",
      rowGroup: "approval",
      description: "Operational disposition, approval status, and remarks.",
      allowDynamicRows: true,
    },
  ],
  metricColumns: [
    {
      key: "shade_band",
      label: "Shade band",
      valueType: "text",
      sectionId: "buyer_shade",
      defaultValue: "",
    },
    {
      key: "gsm",
      label: "GSM",
      valueType: "number",
      unitOfMeasure: "gsm",
      sectionId: "wet_finish",
      defaultValue: "0",
    },
    {
      key: "shrinkage_percent",
      label: "Shrinkage",
      valueType: "number",
      unitOfMeasure: "%",
      sectionId: "wet_finish",
      defaultValue: "0",
    },
    {
      key: "approval_status",
      label: "Approval",
      valueType: "text",
      sectionId: "approval",
      defaultValue: "Pending",
    },
    {
      key: "remarks",
      label: "Remarks",
      valueType: "text",
      sectionId: "approval",
      defaultValue: "",
    },
  ],
  pinnedRows: [
    {
      id: "wf_test_operational_summary",
      label: "Operational summary",
      position: "top",
      values: {
        row_group: "summary",
        row_key: "wf_test_summary",
      },
    },
  ],
  readonlyRowKeys: ["wf_test_summary"],
  summary: {
    showMetricCount: true,
    showRowCount: true,
    pinnedSummaryRows: true,
  },
};
