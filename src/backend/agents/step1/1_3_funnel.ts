// Agent 1.3 — funnel drop-off. Pure code. This is the heart of the product.
//
// The distinction that matters here is between a funnel that is LEAKY and one
// that CHANGED. A bakery that loses 70% of visitors at /checkout every day has a
// 70% drop-off and no news; if that same step goes to 85% today, that is the
// finding. So every step is measured against its own 14-day history, and the
// biggest leak is the most *elevated* step, not the steepest one.
import type { SiteData, FunnelResult, FunnelStepResult, FunnelStepRaw } from "../../../shared/types";

/** Drop-off between one step and the next, as a percentage of those who entered. */
function dropoff(steps: FunnelStepRaw[], i: number): number {
  const entered = steps[i]?.sessions ?? 0;
  if (entered === 0) return 0;
  // The final step has nowhere to drop to, so it never reports drop-off.
  const next = steps[i + 1]?.sessions ?? entered;
  return +(((entered - next) / entered) * 100).toFixed(1);
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

export function analyzeFunnel(data: SiteData): FunnelResult {
  const steps = data.funnelSteps;
  const baselines = data.baselineFunnels ?? [];

  const results: FunnelStepResult[] = steps.map((step, i) => {
    const dropoffPct = dropoff(steps, i);

    // Only compare against baseline days that are actually comparable:
    //  - same funnel shape (a client who reconfigured has no usable history), and
    //  - the step actually saw traffic that day.
    // The second filter matters more than it looks. A day with no sessions has a
    // drop-off of 0% by definition, so counting it would drag the norm toward
    // zero and make an ordinary day look like a collapse — which is exactly how
    // a site with an outage, or one whose tracking went live last week, would get
    // emailed "your funnel broke" every morning.
    const priorDrops = baselines
      .filter(
        (b) =>
          b.length === steps.length && b[i]?.page === step.page && (b[i]?.sessions ?? 0) > 0,
      )
      .map((b) => dropoff(b, i));

    if (priorDrops.length === 0) {
      return { page: step.page, entered: step.sessions, dropoffPct };
    }

    const baselineDropoffPct = +mean(priorDrops).toFixed(1);
    return {
      page: step.page,
      entered: step.sessions,
      dropoffPct,
      baselineDropoffPct,
      elevationPct: +(dropoffPct - baselineDropoffPct).toFixed(1),
    };
  });

  const empty: FunnelStepResult = { page: "", entered: 0, dropoffPct: 0 };

  // Rank by elevation where we have history, otherwise by raw drop-off. Mixing
  // the two would let a step with no history outrank a genuinely broken one.
  const scored = results.some((r) => r.elevationPct !== undefined)
    ? results.filter((r) => r.elevationPct !== undefined)
    : results;

  const biggestLeak = scored.reduce((a, b) => {
    const av = a.elevationPct ?? a.dropoffPct;
    const bv = b.elevationPct ?? b.dropoffPct;
    return bv > av ? b : a;
  }, scored[0] ?? empty);

  return { steps: results, biggestLeak };
}
