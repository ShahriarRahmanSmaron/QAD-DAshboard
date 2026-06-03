"use client";

import React, { useRef, useState, useMemo } from "react";
import { useChartTheme } from "./use-chart-theme";
import type { HeatmapDataset } from "./types";
import { ChartExportButtons } from "./export-buttons";
import { formatShortDate } from "./adapters";

type HeatmapChartProps = {
  data: HeatmapDataset;
  title?: string;
  formatValue?: (value: number) => string;
};

export function HeatmapChart({ data, title, formatValue }: HeatmapChartProps) {
  const { isDark } = useChartTheme();
  const [displayMode, setDisplayMode] = useState<"percentage" | "value">("percentage");
  const containerRef = useRef<HTMLDivElement>(null);

  // Calculate delta value or delta percentage between adjacent report dates
  const { deltaMatrix, maxAbs } = useMemo(() => {
    const matrix: Record<string, Record<string, number>> = {};
    let maxVal = 0;

    for (const row of data.rows) {
      matrix[row] = {};
      const rowVals = data.matrix[row] || {};

      // Column 0 is baseline (delta = 0)
      if (data.columns.length > 0) {
        const firstCol = data.columns[0];
        if (firstCol) matrix[row][firstCol] = 0;
      }

      for (let i = 1; i < data.columns.length; i++) {
        const prevCol = data.columns[i - 1];
        const currCol = data.columns[i];
        if (!prevCol || !currCol) continue;
        const prevVal = rowVals[prevCol] ?? 0;
        const currVal = rowVals[currCol] ?? 0;

        const deltaVal = currVal - prevVal;
        const deltaPercent = prevVal !== 0 ? (deltaVal / prevVal) * 100 : 0;

        const delta = displayMode === "percentage" ? deltaPercent : deltaVal;
        matrix[row][currCol] = delta;

        if (Math.abs(delta) > maxVal) {
          maxVal = Math.abs(delta);
        }
      }
    }

    return { deltaMatrix: matrix, maxAbs: maxVal };
  }, [data, displayMode]);

  if (!data.rows.length || !data.columns.length) {
    return (
      <div className="flex h-[300px] items-center justify-center rounded-lg border border-border bg-card p-6">
        <p className="text-sm text-muted-foreground">No heatmap data available</p>
      </div>
    );
  }

  // Dimensions for SVG replica export
  const colWidth = 90;
  const rowHeight = 44;
  const labelWidth = 120;
  const totalWidth = labelWidth + data.columns.length * colWidth;
  const totalHeight = (title ? 55 : 30) + data.rows.length * rowHeight;

  // Resolve cell visual properties
  const getCellDetails = (row: string, col: string, isFirstCol: boolean) => {
    if (isFirstCol) {
      return {
        bgColor: isDark ? "rgba(51, 65, 85, 0.15)" : "rgba(241, 245, 249, 0.5)",
        textColor: "text-muted-foreground/60",
        labelText: "—",
        opacity: 1,
        rawVal: 0,
      };
    }

    const val = deltaMatrix[row]?.[col] ?? 0;
    const isPositive = val > 0;
    const isNegative = val < 0;

    // Backlog growth = deterioration (Red), Backlog shrink = improvement (Green)
    const bgColor = isPositive
      ? "rgba(239, 68, 68, 1)" // Tailwind red-500
      : isNegative
      ? "rgba(34, 197, 94, 1)" // Tailwind green-500
      : isDark
      ? "rgba(71, 85, 105, 0.3)"
      : "rgba(226, 232, 240, 0.5)";

    const alpha = maxAbs > 0 ? 0.12 + (Math.abs(val) / maxAbs) * 0.78 : 0.08;
    const textColor =
      val === 0
        ? "text-muted-foreground"
        : alpha > 0.52
        ? "text-white"
        : isDark
        ? "text-slate-100"
        : "text-slate-900";

    const formattedVal =
      displayMode === "percentage"
        ? `${isPositive ? "+" : ""}${val.toFixed(1)}%`
        : `${isPositive ? "+" : ""}${formatValue ? formatValue(val) : Math.round(val).toLocaleString()}`;

    const labelText = val === 0 ? "0" : formattedVal;

    return {
      bgColor,
      textColor,
      labelText,
      opacity: alpha,
      rawVal: val,
    };
  };

  return (
    <div ref={containerRef} className="w-full rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-3 border-b border-border/55 pb-3">
        <div>
          {title && <h3 className="text-sm font-semibold text-foreground">{title}</h3>}
          <p className="text-[11px] text-muted-foreground">
            Deterioration in <span className="text-red-500 font-semibold">Red</span> · Improvement in{" "}
            <span className="text-green-500 font-semibold">Green</span>
          </p>
        </div>

        <div className="flex items-center gap-3 print-hidden">
          {/* Display Mode Toggle */}
          <div className="flex items-center gap-1 rounded-md border border-input bg-background p-0.5 text-xs font-medium shadow-sm">
            <button
              onClick={() => setDisplayMode("percentage")}
              className={`rounded px-2.5 py-1 transition-colors ${
                displayMode === "percentage"
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Delta %
            </button>
            <button
              onClick={() => setDisplayMode("value")}
              className={`rounded px-2.5 py-1 transition-colors ${
                displayMode === "value"
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Delta Value
            </button>
          </div>

          <ChartExportButtons containerRef={containerRef} filename={title} />
        </div>
      </div>

      <div className="w-full overflow-x-auto">
        <div
          className="grid gap-1"
          style={{
            gridTemplateColumns: `minmax(110px, max-content) repeat(${data.columns.length}, minmax(70px, 1fr))`,
          }}
        >
          {/* Header row */}
          <div className="sticky left-0 bg-card z-10" />
          {data.columns.map((col) => (
            <div
              key={`head-${col}`}
              className="px-1 pb-1 text-center text-xs font-semibold text-muted-foreground"
            >
              {data.columnLabels[col] ?? col}
            </div>
          ))}

          {/* Data rows */}
          {data.rows.map((row) => (
            <React.Fragment key={row}>
              <div className="sticky left-0 flex items-center bg-card pr-2 text-xs font-semibold text-foreground text-ellipsis overflow-hidden whitespace-nowrap z-10">
                {row}
              </div>
              {data.columns.map((col, idx) => {
                const { bgColor, textColor, labelText, opacity } = getCellDetails(
                  row,
                  col,
                  idx === 0
                );
                const isZero = labelText === "—" || labelText === "0";
                return (
                  <div
                    key={`${row}-${col}`}
                    className={`flex h-11 items-center justify-center rounded text-xs font-semibold tabular-nums shadow-sm ${textColor}`}
                    style={{
                      backgroundColor: bgColor,
                      opacity: isZero ? 0.6 : opacity,
                    }}
                    title={`${row} · ${formatShortDate(col)}: ${labelText}`}
                  >
                    <span>{labelText}</span>
                  </div>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Hidden SVG replica for client-side PNG/JPEG/SVG export */}
      <div className="hidden" aria-hidden="true">
        <svg
          width={totalWidth}
          height={totalHeight}
          viewBox={`0 0 ${totalWidth} ${totalHeight}`}
          xmlns="http://www.w3.org/2000/svg"
          style={{ backgroundColor: isDark ? "#1e293b" : "#ffffff" }}
        >
          {/* Title */}
          {title && (
            <text
              x={10}
              y={20}
              fill={isDark ? "#f8fafc" : "#0f172a"}
              fontSize={12}
              fontWeight="bold"
            >
              {title}
            </text>
          )}

          {/* Headers */}
          {data.columns.map((col, i) => (
            <text
              key={col}
              x={labelWidth + i * colWidth + colWidth / 2}
              y={title ? 42 : 18}
              fill={isDark ? "#94a3b8" : "#64748b"}
              fontSize={10}
              fontWeight="600"
              textAnchor="middle"
            >
              {data.columnLabels[col] ?? col}
            </text>
          ))}

          {/* Rows */}
          {data.rows.map((row, rowIndex) => {
            const yOffset = (title ? 50 : 25) + rowIndex * rowHeight;
            return (
              <g key={row}>
                {/* Row Label */}
                <text
                  x={10}
                  y={yOffset + rowHeight / 2 + 3}
                  fill={isDark ? "#f8fafc" : "#0f172a"}
                  fontSize={10}
                  fontWeight="600"
                >
                  {row}
                </text>

                {/* Cells */}
                {data.columns.map((col, colIndex) => {
                  const xOffset = labelWidth + colIndex * colWidth;
                  const { labelText, opacity, rawVal } = getCellDetails(
                    row,
                    col,
                    colIndex === 0
                  );

                  const isZero = labelText === "—" || labelText === "0";
                  const fillHex = isZero
                    ? isDark
                      ? "#334155"
                      : "#e2e8f0"
                    : rawVal > 0
                    ? "#ef4444" // red
                    : "#22c55e"; // green

                  const textHex = isZero
                    ? isDark
                      ? "#94a3b8"
                      : "#64748b"
                    : opacity > 0.52
                    ? "#ffffff"
                    : isDark
                    ? "#f8fafc"
                    : "#0f172a";

                  return (
                    <g key={col}>
                      <rect
                        x={xOffset}
                        y={yOffset}
                        width={colWidth - 4}
                        height={rowHeight - 4}
                        fill={fillHex}
                        opacity={isZero ? 0.6 : opacity}
                        rx={4}
                      />
                      <text
                        x={xOffset + (colWidth - 4) / 2}
                        y={yOffset + (rowHeight - 4) / 2 + 3}
                        fill={textHex}
                        fontSize={9}
                        fontWeight="700"
                        textAnchor="middle"
                      >
                        {labelText}
                      </text>
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
