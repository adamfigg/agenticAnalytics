// Agent 2.1 — assemble the digest object and decide shouldSend.
// Mostly deterministic. The suppression gate lives HERE, before any model call.
import type { Step1Bundle, Digest, Metric, Leak, Win } from "../../../shared/types";
import { isSignificant } from "../../lib/math";

/** A metric must move this much against baseline to be worth a send. */
const MOVE_THRESHOLD_PCT = 15;

/** A step must lose at least this much before it is worth mentioning at all. */
const LEAK_FLOOR_PCT = 40;

/**
 * ...and be at least this many percentage points worse than the step's own
 * 14-day norm before it counts as a finding. This is what separates "your funnel
 * is shaped like this" from "your funnel broke yesterday", and it is the reason
 * a steady-state site stays quiet. See CLAUDE.md -> "Suppression rule".
 */
const LEAK_ELEVATION_PCT = 15;

/** Elevation beyond this is bad enough to be worth an email on its own. */
const LEAK_SEVERE_ELEVATION_PCT = 25;

export interface ComposeInput {
  siteId: string;
  period: string;
  step1: Step1Bundle;
}

export function compose(input: ComposeInput): Digest {
  const { stats, trends, funnel } = input.step1;
  const worst = funnel.biggestLeak;

  const metrics: Metric[] = [
    { label: "Visitors", value: stats.totalVisitors, deltaPct: stats.visitorsDeltaPct },
    // TODO: conversions have no baseline yet, so this delta is always 0 and the
    // gate cannot see a conversion collapse. Wire it up when the store provides
    // prior-day conversion counts.
    { label: "Conversions", value: stats.totalConversions, deltaPct: 0 },
  ];

  const leak = buildLeak(worst);

  const win: Win | null =
    trends.highTrafficPages[0] != null
      ? {
          page: trends.highTrafficPages[0].page,
          detail: `${trends.highTrafficPages[0].page} drew the most traffic`,
        }
      : null;

  // Send only when something actually moved AND the sample is big enough to
  // trust. Small sites have few sessions; percentage deltas are noise otherwise.
  const movedEnough =
    Math.abs(stats.visitorsDeltaPct) >= MOVE_THRESHOLD_PCT || leak?.severity === "high";
  const shouldSend = movedEnough && isSignificant(stats.totalVisitors);

  const headline =
    leak && leak.severity !== "low"
      ? `Drop-off spotted at ${leak.page}`
      : `Traffic ${trends.overallDirection} this period`;

  return {
    siteId: input.siteId,
    period: input.period,
    headline,
    metrics,
    leak,
    win,
    narrative: "",
    shouldSend,
  };
}

function buildLeak(worst: Step1Bundle["funnel"]["biggestLeak"]): Leak | null {
  if (!worst || !worst.page || worst.dropoffPct < LEAK_FLOOR_PCT) return null;

  // No history for this step — a first-week site, or a reconfigured funnel. We
  // can see the drop-off but not whether it is new, so we report it and refuse
  // to let it trigger a send on its own.
  if (worst.elevationPct === undefined) {
    return {
      page: worst.page,
      detail: `${worst.dropoffPct}% of visitors leave at ${worst.page}`,
      severity: "low",
    };
  }

  if (worst.elevationPct < LEAK_ELEVATION_PCT) return null;

  return {
    page: worst.page,
    detail:
      `${worst.dropoffPct}% of visitors leave at ${worst.page}, ` +
      `up from ${worst.baselineDropoffPct}% normally`,
    severity: worst.elevationPct >= LEAK_SEVERE_ELEVATION_PCT ? "high" : "medium",
  };
}
