"use client";

/**
 * MD08-3A: Unit vs Date Heatmap
 *
 * Rows are grouping-dimension values (e.g. units), columns are report dates,
 * and color intensity encodes the metric total for that cell. Pure CSS grid
 * so it stays responsive and theme-aware without an extra chart dependency.
 */

import { useChartTheme } from "./use-chart-theme";
import type { HeatmapDataset } from "./types";

type HeatmapChartProps = {
  data: HeatmapDataset;
  title?: string;
  formatValue?: (value: number) => string;
};

/**
 * Map a value within [min, max] to an intensity in [0.08, 1] so even the
 * lowest non-zero cell is faintly visible while the peak is fully saturated.
 */
function intensity(value: number, min: number, max: number): number {
  if (max <= min) return value > 0 ? 0.6 : 0.08;
  const ratio = (value - min) / (max - min);
  return 0.08 + ratio * 0.92;
}

export function HeatmapChart({ data, title, formatValue }: HeatmapChartProps) {
  const { getColor, isDark } = useChartTheme();
  const accent = getColor(0);
  const format = formatValue ?? ((v: number) => v.toLocaleString());

  if (!data.rows.length || !data.columns.length) {
    return (
      <div className="flex h-[300px] items-center justify-center rounded-lg border border-border bg-card p-6">
        <p className="text-sm text-muted-foreground">No heatmap data available</p>
      </div>
    );
  }

  return (
    <div className="w-full overflow-x-auto rounded-lg border border-border bg-card p-4">
      {title && (
        <h3 className="mb-3 text-sm font-semibold text-foreground">{title}</h3>
      )}
      <div
        className="grid gap-1"
        style={{
          gridTemplateColumns: `minmax(110px, max-content) repeat(${data.columns.length}, minmax(64px, 1fr))`,
        }}
      >
        {/* Header row */}
        <div className="sticky left-0 bg-card" />
        {data.columns.map((col) => (
          <div
            key={`head-${col}`}
            className="px-1 pb-1 text-center text-xs font-medium text-muted-foreground"
          >
            {data.columnLabels[col] ?? col}
          </div>
        ))}

        {/* Data rows */}
        {data.rows.map((row) => (
          <HeatmapRow
            key={row}
            row={row}
            columns={data.columns}
            cells={data.matrix[row] ?? {}}
            min={data.min}
            max={data.max}
            accent={accent}
            isDark={isDark}
            format={format}
          />
        ))}
      </div>
    </div>
  );
}

function HeatmapRow({
  row,
  columns,
  cells,
  min,
  max,
  accent,
  isDark,
  format,
}: {
  row: string;
  columns: string[];
  cells: Record<string, number>;
  min: number;
  max: number;
  accent: string;
  isDark: boolean;
  format: (value: number) => string;
}) {
  return (
    <>
      <div className="sticky left-0 flex items-center bg-card pr-2 text-xs font-medium text-foreground">
        {row}
      </div>
      {columns.map((col) => {
        const value = cells[col] ?? 0;
        const alpha = intensity(value, min, max);
        // Text contrast: dark cells get light text, faint cells keep muted text.
        const textClass =
          alpha > 0.55
            ? isDark
              ? "text-white"
              : "text-white"
            : "text-foreground";
        return (
          <div
            key={`${row}-${col}`}
            className={`flex h-12 items-center justify-center rounded text-xs font-medium tabular-nums ${textClass}`}
            style={{ backgroundColor: accent, opacity: alpha }}
            title={`${row} · ${col}: ${format(value)}`}
          >
            <span style={{ opacity: alpha < 0.2 ? 0.8 : 1 }}>{format(value)}</span>
          </div>
        );
      })}
    </>
  );
}
