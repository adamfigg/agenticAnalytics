// Agent 1.1 — statistical summary. Pure code, no model.
import type { SiteData, StatsResult } from "../../../shared/types";
import { mean, pctDelta } from "../../lib/math";

export function analyzeStats(data: SiteData): StatsResult {
  const rate =
    data.totalVisitors === 0
      ? 0
      : +((data.conversions / data.totalVisitors) * 100).toFixed(2);

  // Conversions only get a delta when there is history to compare against.
  // Returning undefined rather than 0 matters: 0 would tell the gate "orders
  // held steady" on a day we simply cannot see, and a silent false negative on
  // conversions is the worst failure this product has.
  const priorConversions = data.baselineConversions ?? [];
  const hasHistory = priorConversions.length > 0;
  const baselineConversionsMean = hasHistory ? mean(priorConversions) : undefined;
  const conversionsDeltaPct = hasHistory
    ? pctDelta(data.conversions, baselineConversionsMean!)
    : undefined;

  return {
    totalVisitors: data.totalVisitors,
    totalConversions: data.conversions,
    conversionRatePct: rate,
    visitorsDeltaPct: pctDelta(data.totalVisitors, mean(data.baselineVisitors)),
    conversionsDeltaPct,
    baselineConversionsMean,
  };
}
