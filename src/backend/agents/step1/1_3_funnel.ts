// Agent 1.3 — funnel drop-off. Pure code. This is the heart of the product.
import type { SiteData, FunnelResult, FunnelStepResult } from "../../../shared/types";

export function analyzeFunnel(data: SiteData): FunnelResult {
  const steps = data.funnelSteps;
  const results: FunnelStepResult[] = steps.map((step, i) => {
    const entered = step.sessions;
    const next = steps[i + 1]?.sessions ?? entered;
    const dropoffPct =
      entered === 0 ? 0 : +(((entered - next) / entered) * 100).toFixed(1);
    return { page: step.page, entered, dropoffPct };
  });
  const biggestLeak = results.reduce(
    (a, b) => (b.dropoffPct > a.dropoffPct ? b : a),
    results[0] ?? { page: "", entered: 0, dropoffPct: 0 }
  );
  return { steps: results, biggestLeak };
}
