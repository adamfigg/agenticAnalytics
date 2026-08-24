// Agent 1.5 — best/worst CTA by click-through. Pure code.
import type { SiteData, ConversionCtaResult } from "../../../shared/types";

export function analyzeConversionCta(data: SiteData): ConversionCtaResult {
  const withClicks = data.pages.filter((p) => typeof p.clicks === "number" && p.sessions > 0);
  if (withClicks.length === 0) return { bestCta: null, worstCta: null };

  const scored = withClicks.map((p) => ({
    page: p.page,
    clicks: p.clicks!,
    ctr: +((p.clicks! / p.sessions) * 100).toFixed(1),
  }));
  scored.sort((a, b) => b.ctr - a.ctr);
  return { bestCta: scored[0], worstCta: scored[scored.length - 1] };
}
