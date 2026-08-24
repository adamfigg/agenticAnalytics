// Input step: GA CSV -> typed SiteData. Deterministic, no model.
// Strict by design. If a real export breaks this, add an LLM fallback THEN, not now.
import { parse } from "csv-parse/sync";
import type { SiteData, PageRow, FunnelStepRaw } from "../../shared/types";

export interface ParseInput {
  csv: string;
  siteId: string;
  period: string;
  funnelOrder: string[]; // page paths in funnel order, from client config
  baselineVisitors: number[];
}

export function parseCsvToSiteData(input: ParseInput): SiteData {
  const rows = parse(input.csv, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];

  const pages: PageRow[] = rows.map((r) => ({
    page: r.page ?? r.Page ?? r["Page path"] ?? "",
    views: num(r.views ?? r.Views ?? r["Pageviews"]),
    sessions: num(r.sessions ?? r.Sessions),
    avgTimeOnPageSec: num(r.avgTime ?? r["Avg. time on page"]),
    clicks: r.clicks != null ? num(r.clicks) : undefined,
  }));

  validate(pages);

  const funnelSteps: FunnelStepRaw[] = input.funnelOrder.map((p) => {
    const row = pages.find((pg) => pg.page === p);
    return { page: p, sessions: row?.sessions ?? 0 };
  });

  const totalVisitors = pages.reduce((s, p) => s + p.sessions, 0);
  const conversions = funnelSteps.length
    ? funnelSteps[funnelSteps.length - 1].sessions
    : 0;

  return {
    siteId: input.siteId,
    period: input.period,
    totalVisitors,
    pages,
    funnelSteps,
    conversions,
    avgConversionTimeSec: num(rows[0]?.avgConversionTime ?? "0"),
    baselineVisitors: input.baselineVisitors,
  };
}

function num(v: string | undefined): number {
  const n = Number((v ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function validate(pages: PageRow[]): void {
  if (pages.length === 0) throw new Error("parse_csv: no rows found in CSV");
  const bad = pages.find((p) => !p.page);
  if (bad) throw new Error("parse_csv: a row is missing a page path");
}
