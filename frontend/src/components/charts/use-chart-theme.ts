"use client";

/**
 * MD08-1: Visualization Foundation — useChartTheme hook
 *
 * Returns the current chart theme based on the active light/dark mode.
 */

import { useTheme } from "next-themes";
import { useMemo } from "react";
import { getChartTheme, getSeriesColor, type ChartTheme } from "./theme";

export function useChartTheme() {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const theme = useMemo<ChartTheme>(() => getChartTheme(isDark), [isDark]);

  const getColor = useMemo(
    () => (index: number) => getSeriesColor(index, isDark),
    [isDark],
  );

  return { theme, isDark, getColor };
}
