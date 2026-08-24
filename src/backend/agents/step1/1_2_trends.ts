// Agent 1.2 — high/low traffic pages and overall direction. Pure code.
import type { SiteData, TrendsResult } from "../../../shared/types";
import { mean } from "../../lib/math";

export function analyzeTrends(data: SiteData): TrendsResult {
  const sorted = [...data.pages].sort((a, b) => b.views - a.views);
  const high = sorted.slice(0, 3).map((p) => ({ page: p.page, views: p.views }));
  const low = sorted.slice(-3).reverse().map((p) => ({ page: p.page, views: p.views }));

  const base = mean(data.baselineVisitors);
  let direction: TrendsResult["overallDirection"] = "flat";
  if (base > 0) {
    const change = (data.totalVisitors - base) / base;
    if (change > 0.05) direction = "up";
    else if (change < -0.05) direction = "down";
  }
  return { highTrafficPages: high, lowTrafficPages: low, overallDirection: direction };
}
