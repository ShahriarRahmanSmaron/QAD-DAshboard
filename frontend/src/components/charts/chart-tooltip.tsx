"use client";

/**
 * MD08-1: Visualization Foundation — Custom Chart Tooltip
 *
 * Styled tooltip that respects the app's light/dark theme.
 */

type TooltipPayloadEntry = {
  dataKey?: string | number;
  name?: string;
  value?: number;
  color?: string;
};

type ChartTooltipProps = {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string;
  formatValue?: (value: number) => string;
};

export function ChartTooltip({ active, payload, label, formatValue }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;

  const format = formatValue ?? ((v: number) => v.toLocaleString());

  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 shadow-md">
      <p className="mb-1 text-xs font-medium text-muted-foreground">{label}</p>
      {payload.map((entry) => (
        <div key={String(entry.dataKey)} className="flex items-center gap-2 text-sm">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-foreground">{entry.name}:</span>
          <span className="font-semibold text-foreground">
            {format(entry.value as number)}
          </span>
        </div>
      ))}
    </div>
  );
}
