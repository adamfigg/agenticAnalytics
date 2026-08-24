// Agent 1.1 — statistical summary. Pure code, no model.
import type { SiteData, StatsResult } from "../../../shared/types";
import { mean, pctDelta } from "../../lib/math";

export function analyzeStats(data: SiteData): StatsResult {
  const rate =
    data.totalVisitors === 0
      ? 0
      : +((data.conversions / data.totalVisitors) * 100).toFixed(2);
  return {
    totalVisitors: data.totalVisitors,
    totalConversions: data.conversions,
    conversionRatePct: rate,
    visitorsDeltaPct: pctDelta(data.totalVisitors, mean(data.baselineVisitors)),
  };
}
