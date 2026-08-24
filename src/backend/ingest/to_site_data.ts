// Adapter: stored counters -> SiteData, the same shape `parse_csv.ts` produces.
//
// This is the join between the two halves of the product. Everything downstream
// — all of step 1, the compose gate, the single model call — is untouched and
// cannot tell whether a day came from a CSV import or from live tracking.
import type { SiteData, PageRow, FunnelStepRaw } from "../../shared/types";
import type { CounterStore } from "./store";
import type { DayCounters } from "./counters";

export const BASELINE_DAYS = 14;

function toPageRows(day: DayCounters): PageRow[] {
  return Object.entries(day.pages).map(([path, c]) => ({
    page: path,
    views: c.views,
    sessions: c.sessions,
    avgTimeOnPageSec:
      c.timeSamples === 0 ? 0 : +(c.timeOnPageTotalSec / c.timeSamples).toFixed(1),
    clicks: c.clicks,
  }));
}

export interface BuildInput {
  store: CounterStore;
  siteId: string;
  /** The day being reported on, ISO, client-local. */
  period: string;
  /** Page paths in funnel order, from the client's config. */
  funnelOrder: string[];
}

/**
 * Assemble a day's SiteData plus its 14-day baseline. Returns null when the day
 * has no counters at all — the caller should skip the site rather than send a
 * digest full of zeroes.
 */
export async function buildSiteData(input: BuildInput): Promise<SiteData | null> {
  const day = await input.store.get(input.siteId, input.period);
  if (!day) return null;

  const pages = toPageRows(day);
  const byPath = new Map(pages.map((p) => [p.page, p]));

  const funnelSteps: FunnelStepRaw[] = input.funnelOrder.map((path) => ({
    page: path,
    sessions: byPath.get(path)?.sessions ?? 0,
  }));

  const baselineDays = await input.store.baseline(
    input.siteId,
    input.period,
    BASELINE_DAYS,
  );

  // The same funnel, as it looked on each baseline day. Without this the gate
  // cannot tell a step that broke today from one that always looked this way,
  // and every steadily-leaky site would be emailed daily.
  const baselineFunnels = baselineDays.map((d) =>
    input.funnelOrder.map((path) => ({
      page: path,
      sessions: d.pages[path]?.sessions ?? 0,
    })),
  );

  return {
    siteId: input.siteId,
    period: input.period,
    // NOTE: this is the true distinct-visitor count. `parse_csv.ts` instead sums
    // per-page sessions, which overcounts anyone who views two pages. The two
    // input paths therefore disagree on this number, and the suppression gate
    // reads it — reconcile before running both paths against the same site.
    totalVisitors: day.visitors,
    pages,
    funnelSteps,
    // Explicit `convert` events win when the owner wired the hook; otherwise
    // fall back to sessions on the last funnel step, which is what the CSV path
    // does. Keeps onboarding to a single script tag with no extra config.
    conversions:
      day.conversions > 0
        ? day.conversions
        : (funnelSteps[funnelSteps.length - 1]?.sessions ?? 0),
    avgConversionTimeSec:
      day.conversionSamples === 0
        ? 0
        : +(day.conversionTimeTotalSec / day.conversionSamples).toFixed(1),
    baselineVisitors: baselineDays.map((d) => d.visitors),
    baselineFunnels,
  };
}
