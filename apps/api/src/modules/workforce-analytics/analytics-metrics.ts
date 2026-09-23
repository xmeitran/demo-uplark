import type {
  AnalyticsMetricCoverage,
  AnalyticsMetricKey,
  AnalyticsMetricState,
  AnalyticsMetricValue
} from "@b2b-crm/contracts";

/**
 * Pure KPI assembly. Zero/missing denominators always become N/A (value=null,
 * state partial/unavailable) so an API/data gap can never render as a false 0.
 */

export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function countMetric(
  key: AnalyticsMetricKey,
  value: number,
  options: { coverage?: AnalyticsMetricCoverage; previousValue?: number | null; warnings?: string[]; state?: AnalyticsMetricState } = {}
): AnalyticsMetricValue {
  return {
    key,
    state: options.state ?? "available",
    value: Math.round(value),
    coverage: options.coverage,
    previousValue: options.previousValue ?? undefined,
    deltaPercent: deltaPercent(Math.round(value), options.previousValue),
    warnings: options.warnings
  };
}

export function ratioMetric(
  key: AnalyticsMetricKey,
  numerator: number | null,
  denominator: number | null,
  options: {
    coverage?: AnalyticsMetricCoverage;
    previousValue?: number | null;
    warnings?: string[];
    /** state to use when the denominator is missing/zero */
    missingState?: AnalyticsMetricState;
    decimals?: number;
  } = {}
): AnalyticsMetricValue {
  const decimals = options.decimals ?? 1;
  if (numerator === null || denominator === null || denominator <= 0) {
    return {
      key,
      state: options.missingState ?? "partial",
      value: null,
      numerator,
      denominator,
      coverage: options.coverage,
      previousValue: options.previousValue ?? undefined,
      deltaPercent: null,
      warnings: options.warnings
    };
  }
  const value = roundTo((numerator / denominator) * 100, decimals);
  return {
    key,
    state: coverageState(options.coverage) ?? "available",
    value,
    numerator,
    denominator,
    coverage: options.coverage,
    previousValue: options.previousValue ?? undefined,
    deltaPercent: deltaPercent(value, options.previousValue),
    warnings: options.warnings
  };
}

export function coverageState(coverage?: AnalyticsMetricCoverage): AnalyticsMetricState | undefined {
  if (!coverage) return undefined;
  if (coverage.total <= 0) return "unavailable";
  if (coverage.covered <= 0) return "unavailable";
  if (coverage.covered < coverage.total) return "partial";
  return "available";
}

export function deltaPercent(current: number | null, previous?: number | null): number | null {
  if (current === null || previous === null || previous === undefined) return null;
  if (previous === 0) return null;
  return roundTo(((current - previous) / Math.abs(previous)) * 100, 1);
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}
