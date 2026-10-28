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

/**
 * Conversions are a much smaller number than visitors, so the same percentage
 * threshold is far noisier here: 5 orders falling to 2 is -60% and means
 * nothing. Require this many conversions on a typical day before a conversion
 * delta is allowed to trigger a send at all.
 */
const MIN_BASELINE_CONVERSIONS = 10;

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
    {
      label: "Conversions",
      value: stats.totalConversions,
      // A missing baseline renders as 0 because Metric has nowhere to say "no
      // history". The gate below reads `stats.conversionsDeltaPct` directly, so
      // it can still tell the two apart — do not gate on this number.
      deltaPct: stats.conversionsDeltaPct ?? 0,
    },
  ];

  const leak = buildLeak(worst);

  // A win is something that actually improved, not simply the busiest page.
  // Most days there is no win, and that is correct: a "bright spot" printed
  // every morning is one the owner stops reading by the second week.
  const win: Win | null = trends.risingPage
    ? {
        page: trends.risingPage.page,
        detail: `${trends.risingPage.page} traffic is up ${trends.risingPage.deltaPct}% on its usual`,
      }
    : null;

  // Send only when something actually moved AND the sample is big enough to
  // trust. Small sites have few sessions; percentage deltas are noise otherwise.
  // Conversions count as moved only where there is enough history AND enough
  // volume to trust the swing. A site doing 3 orders a day can double or halve
  // on a coin flip; a site doing 40 cannot.
  const conversionsMoved =
    stats.conversionsDeltaPct !== undefined &&
    (stats.baselineConversionsMean ?? 0) >= MIN_BASELINE_CONVERSIONS &&
    Math.abs(stats.conversionsDeltaPct) >= MOVE_THRESHOLD_PCT;

  const movedEnough =
    Math.abs(stats.visitorsDeltaPct) >= MOVE_THRESHOLD_PCT ||
    conversionsMoved ||
    leak?.severity === "high";
  const shouldSend = movedEnough && isSignificant(stats.totalVisitors);

  // Lead with the thing the owner would care about most: a broken step first,
  // then orders moving, then traffic. Without the middle case a day where orders
  // halved but traffic held would be headlined "Traffic flat this period", which
  // is true and useless.
  const headline =
    leak && leak.severity !== "low"
      ? `Drop-off spotted at ${leak.page}`
      : conversionsMoved
        ? `${stats.totalConversions < (stats.baselineConversionsMean ?? 0) ? "Orders dropped" : "Orders jumped"} this period`
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
