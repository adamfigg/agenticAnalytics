// Agent 1.2 — traffic shape and what actually improved. Pure code.
//
// The distinction that matters here mirrors the one in the funnel agent: the
// BUSIEST page is not news, because it is the busiest page every day. Only a
// page that rose against its own norm is worth telling the owner about.
import type { SiteData, TrendsResult } from "../../../shared/types";
import { mean, pctDelta } from "../../lib/math";

/**
 * A page needs at least this many sessions on a typical day before a percentage
 * rise means anything. Two visitors becoming four is +100% and is noise.
 */
const MIN_BASELINE_SESSIONS = 20;

/** ...and must rise at least this much to count as a win worth reporting. */
const WIN_RISE_PCT = 15;

function findRisingPage(data: SiteData): TrendsResult["risingPage"] {
  const baselines = data.baselineFunnels ?? [];
  if (baselines.length === 0) return undefined;

  let best: TrendsResult["risingPage"];

  data.funnelSteps.forEach((step, i) => {
    // Only compare against days with the same funnel shape, and only where the
    // step actually saw traffic — the same filter the funnel agent applies, and
    // for the same reason: a zero day would drag the norm down and manufacture
    // a rise out of nothing.
    const priorSessions = baselines
      .filter(
        (b) =>
          b.length === data.funnelSteps.length &&
          b[i]?.page === step.page &&
          (b[i]?.sessions ?? 0) > 0,
      )
      .map((b) => b[i]!.sessions);

    if (priorSessions.length === 0) return;

    const norm = mean(priorSessions);
    if (norm < MIN_BASELINE_SESSIONS) return;

    const deltaPct = pctDelta(step.sessions, norm);
    if (deltaPct < WIN_RISE_PCT) return;

    if (!best || deltaPct > best.deltaPct) {
      best = { page: step.page, sessions: step.sessions, deltaPct };
    }
  });

  return best;
}

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

  return {
    highTrafficPages: high,
    lowTrafficPages: low,
    overallDirection: direction,
    risingPage: findRisingPage(data),
  };
}
