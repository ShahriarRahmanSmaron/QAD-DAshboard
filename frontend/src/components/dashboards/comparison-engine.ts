/**
 * Shared comparison engine for QAD Dashboard.
 * Serves as the single source of truth for all delta and percentage calculations.
 */

export interface ComparisonItem {
  key: string;
  label: string;
  currentValue: number;
  previousValue: number;
  difference: number;
  differencePercent: number | null;
  direction: "up" | "down" | "flat";
}

/**
 * Calculates current vs previous comparison for a list of items.
 */
export function calculateComparison(
  currentData: { key: string; value: number }[],
  previousData: { key: string; value: number }[]
): ComparisonItem[] {
  const currentMap = new Map(currentData.map((d) => [d.key, d.value]));
  const previousMap = new Map(previousData.map((d) => [d.key, d.value]));
  const allKeys = new Set([...currentMap.keys(), ...previousMap.keys()]);

  return Array.from(allKeys).map((key) => {
    const currentValue = currentMap.get(key) ?? 0;
    const previousValue = previousMap.get(key) ?? 0;
    const difference = currentValue - previousValue;
    const differencePercent =
      previousValue !== 0 ? (difference / previousValue) * 100 : null;
    const direction: "up" | "down" | "flat" =
      difference > 0 ? "up" : difference < 0 ? "down" : "flat";

    return {
      key,
      label: key,
      currentValue,
      previousValue,
      difference,
      differencePercent,
      direction,
    };
  });
}
