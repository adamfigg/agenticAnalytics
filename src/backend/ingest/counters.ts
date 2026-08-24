// Counters: the only shape that ever reaches durable storage.
//
// Two shapes live here, and the distinction is the point:
//
//   DayState    working state while a day is still being counted. Holds HLL
//               sketches, which are one-way and contain no visitor hashes.
//   DayCounters the finished, plain-integer view every reader downstream sees.
//
// Nothing in either identifies a person. See CLAUDE.md -> "No raw event storage".
import { emptySketch, sketchAdd, sketchCount } from "./hll";

/** Per-page aggregates for one site, one day, as read by the rest of the system. */
export interface PageCounters {
  views: number;
  /** Distinct visitors who saw this page. A count, never the visitors. */
  sessions: number;
  clicks: number;
  /** Sum + sample count, so an average survives aggregation without storing samples. */
  timeOnPageTotalSec: number;
  timeSamples: number;
}

export interface DayCounters {
  siteId: string;
  /** ISO date, client-local. */
  date: string;
  visitors: number;
  pages: Record<string, PageCounters>;
  conversions: number;
  conversionTimeTotalSec: number;
  conversionSamples: number;
}

/** Working state for a day still being written to. */
export interface PageState {
  views: number;
  /** Distinct-session sketch for this page. */
  sessions: Uint8Array;
  clicks: number;
  timeOnPageTotalSec: number;
  timeSamples: number;
}

export interface DayState {
  siteId: string;
  date: string;
  /** Site-wide distinct-visitor sketch. */
  visitors: Uint8Array;
  pages: Record<string, PageState>;
  conversions: number;
  conversionTimeTotalSec: number;
  conversionSamples: number;
}

export function newDayState(siteId: string, date: string): DayState {
  return {
    siteId,
    date,
    visitors: emptySketch(),
    pages: {},
    conversions: 0,
    conversionTimeTotalSec: 0,
    conversionSamples: 0,
  };
}

export function newPageState(): PageState {
  return {
    views: 0,
    sessions: emptySketch(),
    clicks: 0,
    timeOnPageTotalSec: 0,
    timeSamples: 0,
  };
}

function pageOf(state: DayState, path: string): PageState {
  let p = state.pages[path];
  if (!p) {
    p = newPageState();
    state.pages[path] = p;
  }
  return p;
}

/** Events the tracking snippet may send. Deliberately tiny — see public/track.js. */
export type RawEvent =
  | { type: "pageview"; path: string }
  | { type: "click"; path: string; element: string }
  | { type: "engagement"; path: string; seconds: number }
  | { type: "convert"; path: string; seconds: number };

/** An engagement sample longer than this is a tab left open, not a reader. */
const MAX_ENGAGEMENT_SEC = 3600;
/** A conversion attributed to more than a day of browsing isn't one. */
const MAX_CONVERSION_SEC = 86_400;

/**
 * Fold one raw event into a day's state.
 *
 * `visitor` is today's rotating hash. It is used to nudge two sketches and is
 * then gone — the caller discards it along with the event, and neither is ever
 * written anywhere. That discard is the "no raw event storage" constraint in
 * practice.
 */
export function applyEvent(state: DayState, event: RawEvent, visitor: string): void {
  sketchAdd(state.visitors, visitor);

  const page = pageOf(state, event.path);

  switch (event.type) {
    case "pageview":
      page.views += 1;
      sketchAdd(page.sessions, visitor);
      break;

    case "click":
      // `element` is an author-supplied data-track label, never scraped from the
      // DOM, so it cannot carry text the visitor typed.
      page.clicks += 1;
      break;

    case "engagement":
      if (event.seconds > 0 && event.seconds < MAX_ENGAGEMENT_SEC) {
        page.timeOnPageTotalSec += event.seconds;
        page.timeSamples += 1;
      }
      break;

    case "convert":
      state.conversions += 1;
      if (event.seconds > 0 && event.seconds < MAX_CONVERSION_SEC) {
        state.conversionTimeTotalSec += event.seconds;
        state.conversionSamples += 1;
      }
      break;
  }
}

/** Collapse working state into the plain-integer view readers see. */
export function materialize(state: DayState): DayCounters {
  const pages: Record<string, PageCounters> = {};
  for (const [path, p] of Object.entries(state.pages)) {
    pages[path] = {
      views: p.views,
      sessions: sketchCount(p.sessions),
      clicks: p.clicks,
      timeOnPageTotalSec: p.timeOnPageTotalSec,
      timeSamples: p.timeSamples,
    };
  }

  return {
    siteId: state.siteId,
    date: state.date,
    visitors: sketchCount(state.visitors),
    pages,
    conversions: state.conversions,
    conversionTimeTotalSec: state.conversionTimeTotalSec,
    conversionSamples: state.conversionSamples,
  };
}
