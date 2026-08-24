// Agent 1.4 — conversion time vs baseline. Pure code.
import type { SiteData, ConversionTimeResult } from "../../../shared/types";

// NOTE: baseline conversion time isn't in SiteData yet. Wire a real baseline in when
// the rollup job exists. For now delta is 0 until you pass prior-period timing.
export function analyzeConversionTime(data: SiteData): ConversionTimeResult {
  return {
    avgConversionTimeSec: data.avgConversionTimeSec,
    deltaPct: 0, // TODO: compare against prior-period avg once rollup provides it
  };
}
