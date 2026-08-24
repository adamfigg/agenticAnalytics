// Test fixtures. Builds SiteData by hand so a test reads as a business scenario
// ("a quiet Tuesday", "a tiny site with a meaningless spike") rather than as a
// wall of numbers. If a test is hard to name in those terms, it is probably
// testing the implementation instead of the product.
import type { SiteData, PageRow, FunnelStepRaw } from "../../shared/types";

export interface DayShape {
  siteId?: string;
  period?: string;
  /** Distinct visitors across the whole site. */
  visitors: number;
  /** Path -> sessions. Insertion order IS the funnel order. */
  funnel: Record<string, number>;
  /** Path -> CTA clicks. Omitted pages report no clicks. */
  clicks?: Record<string, number>;
  /** Prior daily visitor counts, oldest first. */
  baselineVisitors: number[];
  /**
   * The site's TYPICAL funnel, repeated across the baseline window. Supplying
   * this is what lets a test distinguish "always leaks here" from "broke today".
   * Same paths as `funnel`.
   */
  baselineFunnel?: Record<string, number>;
  conversions?: number;
  avgConversionTimeSec?: number;
}

export function makeSiteData(shape: DayShape): SiteData {
  const paths = Object.keys(shape.funnel);

  const pages: PageRow[] = paths.map((page) => {
    const sessions = shape.funnel[page]!;
    return {
      page,
      // Views run a little ahead of sessions; the exact ratio doesn't matter to
      // any assertion, it just keeps the shape realistic.
      views: Math.round(sessions * 1.2),
      sessions,
      avgTimeOnPageSec: 40,
      clicks: shape.clicks?.[page],
    };
  });

  const funnelSteps: FunnelStepRaw[] = paths.map((page) => ({
    page,
    sessions: shape.funnel[page]!,
  }));

  const baselineFunnels = shape.baselineFunnel
    ? shape.baselineVisitors.map(() =>
        paths.map((page) => ({ page, sessions: shape.baselineFunnel![page] ?? 0 })),
      )
    : undefined;

  return {
    siteId: shape.siteId ?? "test-site",
    period: shape.period ?? "2026-08-23",
    totalVisitors: shape.visitors,
    pages,
    funnelSteps,
    conversions: shape.conversions ?? funnelSteps[funnelSteps.length - 1]?.sessions ?? 0,
    avgConversionTimeSec: shape.avgConversionTimeSec ?? 0,
    baselineVisitors: shape.baselineVisitors,
    baselineFunnels,
  };
}

/** A flat 14-day baseline, for scenarios where the baseline itself isn't the point. */
export function flatBaseline(perDay: number, days = 14): number[] {
  return Array.from({ length: days }, () => perDay);
}
