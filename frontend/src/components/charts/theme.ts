/**
 * MD08-1: Visualization Foundation — Chart Theme
 *
 * Provides consistent colors and styling for charts in both light and dark mode.
 * Uses CSS custom properties from globals.css so charts adapt automatically.
 */

// ---------------------------------------------------------------------------
// Color palette for chart series
// ---------------------------------------------------------------------------

export const CHART_COLORS = [
  "oklch(0.62 0.16 38)",   // primary (warm orange)
  "oklch(0.58 0.18 260)",  // blue
  "oklch(0.65 0.16 150)",  // green
  "oklch(0.60 0.20 330)",  // purple
  "oklch(0.68 0.14 80)",   // yellow-green
  "oklch(0.55 0.22 20)",   // red
  "oklch(0.62 0.12 200)",  // teal
  "oklch(0.70 0.10 50)",   // amber
] as const;

export const CHART_COLORS_DARK = [
  "oklch(0.74 0.14 55)",   // primary (warm orange, lighter)
  "oklch(0.70 0.16 260)",  // blue
  "oklch(0.72 0.14 150)",  // green
  "oklch(0.72 0.18 330)",  // purple
  "oklch(0.76 0.12 80)",   // yellow-green
  "oklch(0.68 0.20 20)",   // red
  "oklch(0.72 0.10 200)",  // teal
  "oklch(0.78 0.08 50)",   // amber
] as const;

export function getSeriesColor(index: number, isDark: boolean): string {
  const palette = isDark ? CHART_COLORS_DARK : CHART_COLORS;
  return palette[index % palette.length] as string;
}

// ---------------------------------------------------------------------------
// Chart theme tokens (CSS variable references for Recharts)
// ---------------------------------------------------------------------------

export type ChartTheme = {
  background: string;
  foreground: string;
  muted: string;
  mutedForeground: string;
  border: string;
  gridColor: string;
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
  axisColor: string;
  axisLabelColor: string;
};

export const LIGHT_THEME: ChartTheme = {
  background: "oklch(1 0 0)",
  foreground: "oklch(0.22 0.02 40)",
  muted: "oklch(0.95 0.018 66)",
  mutedForeground: "oklch(0.52 0.035 48)",
  border: "oklch(0.88 0.02 60 / 0.72)",
  gridColor: "oklch(0.92 0.01 60 / 0.5)",
  tooltipBg: "oklch(1 0 0 / 0.96)",
  tooltipBorder: "oklch(0.88 0.02 60 / 0.72)",
  tooltipText: "oklch(0.22 0.02 40)",
  axisColor: "oklch(0.78 0.015 60)",
  axisLabelColor: "oklch(0.52 0.035 48)",
};

export const DARK_THEME: ChartTheme = {
  background: "oklch(0.24 0.02 42 / 0.72)",
  foreground: "oklch(0.96 0.008 70)",
  muted: "oklch(0.27 0.022 44)",
  mutedForeground: "oklch(0.74 0.025 56)",
  border: "oklch(1 0 0 / 0.12)",
  gridColor: "oklch(1 0 0 / 0.06)",
  tooltipBg: "oklch(0.22 0.02 42 / 0.96)",
  tooltipBorder: "oklch(1 0 0 / 0.12)",
  tooltipText: "oklch(0.96 0.008 70)",
  axisColor: "oklch(1 0 0 / 0.15)",
  axisLabelColor: "oklch(0.74 0.025 56)",
};

export function getChartTheme(isDark: boolean): ChartTheme {
  return isDark ? DARK_THEME : LIGHT_THEME;
}
