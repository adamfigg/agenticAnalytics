// Agent 2.1 — assemble the digest object and decide shouldSend.
// Mostly deterministic. The suppression gate lives HERE, before any model call.
import type { Step1Bundle, Digest, Metric, Leak, Win } from "../../../shared/types";
import { isSignificant } from "../../lib/math";

const MOVE_THRESHOLD_PCT = 15; // a metric must move this much to be worth a send

export interface ComposeInput {
  siteId: string;
  period: string;
  step1: Step1Bundle;
}

export function compose(input: ComposeInput): Digest {
  const { stats, trends, funnel, conversionCta } = input.step1;

  const metrics: Metric[] = [
    { label: "Visitors", value: stats.totalVisitors, deltaPct: stats.visitorsDeltaPct },
    { label: "Conversions", value: stats.totalConversions, deltaPct: 0 },
  ];

  const leak: Leak | null =
    funnel.biggestLeak && funnel.biggestLeak.dropoffPct >= 40
      ? {
          page: funnel.biggestLeak.page,
          detail: `${funnel.biggestLeak.dropoffPct}% of visitors leave at ${funnel.biggestLeak.page}`,
          severity: funnel.biggestLeak.dropoffPct >= 60 ? "high" : "medium",
        }
      : null;

  const win: Win | null =
    trends.highTrafficPages[0] != null
      ? {
          page: trends.highTrafficPages[0].page,
          detail: `${trends.highTrafficPages[0].page} drew the most traffic`,
        }
      : null;

  // Suppression gate: only send when something actually moved AND the sample is big
  // enough to trust. Small sites have few sessions; naive deltas are noise otherwise.
  const movedEnough =
    Math.abs(stats.visitorsDeltaPct) >= MOVE_THRESHOLD_PCT || leak?.severity === "high";
  const trustworthy = isSignificant(stats.totalVisitors);
  const shouldSend = movedEnough && trustworthy;

  const headline = leak
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
