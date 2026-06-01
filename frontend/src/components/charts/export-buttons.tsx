import React, { RefObject } from "react";
import { exportChartElement } from "@/lib/export/downloads";

interface ChartExportButtonsProps {
  containerRef: RefObject<HTMLDivElement | null>;
  filename?: string;
  reportType?: string;
  filters?: Record<string, unknown>;
}

export function ChartExportButtons({
  containerRef,
  filename = "chart",
  reportType,
  filters,
}: ChartExportButtonsProps) {
  const handleExport = (type: "png" | "jpeg" | "svg") => {
    const today = new Date().toISOString().split("T")[0];
    const safeBase = filename.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    const ext = type === "jpeg" ? "jpg" : type;
    const exportFilename = `${safeBase}_Trend_${today}.${ext}`;
    void exportChartElement(containerRef.current, type, exportFilename, reportType, filters);
  };

  return (
    <div className="print-hidden flex items-center gap-1">
      <button
        onClick={() => handleExport("png")}
        className="rounded px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-secondary hover:text-foreground transition cursor-pointer"
        title="Export as PNG"
        type="button"
      >
        PNG
      </button>
      <span className="text-muted-foreground/30 text-xs">|</span>
      <button
        onClick={() => handleExport("jpeg")}
        className="rounded px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-secondary hover:text-foreground transition cursor-pointer"
        title="Export as JPEG"
        type="button"
      >
        JPEG
      </button>
      <span className="text-muted-foreground/30 text-xs">|</span>
      <button
        onClick={() => handleExport("svg")}
        className="rounded px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-secondary hover:text-foreground transition cursor-pointer"
        title="Export as SVG"
        type="button"
      >
        SVG
      </button>
    </div>
  );
}
