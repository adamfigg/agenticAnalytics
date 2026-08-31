// Preset scenarios for the test bench.
//
// Each one exercises a different branch of the suppression gate, so loading them
// in turn is a fast manual regression pass over the product's core behaviour:
// does it stay quiet when it should, and speak up when it should?
export interface StepRow {
  path: string;
  /** Sessions that reached this step today. */
  today: number;
  /** What this step normally gets — the site's own 14-day norm. */
  typical: number;
  /** CTA clicks on this page today. */
  clicks: number;
}

export interface BenchForm {
  siteId: string;
  period: string;
  visitors: number;
  steps: StepRow[];
  /** Prior daily visitor counts, oldest first, comma separated. */
  baselineVisitors: string;
  /** Off = no funnel history, which is a first-week site. */
  useTypicalFunnel: boolean;
  /** Blank means "derive from the last funnel step", as the CSV path does. */
  conversions: string;
  /** Typical daily orders. Blank = no history, and orders cannot move the gate. */
  typicalConversions: string;
  avgConversionTimeSec: number;
}

export interface Scenario {
  name: string;
  /** What this preset is meant to prove. Shown under the button. */
  expectation: string;
  form: BenchForm;
}

const flat = (perDay: number, days = 14): string =>
  Array.from({ length: days }, () => perDay).join(", ");

export const SCENARIOS: Scenario[] = [
  {
    name: "Checkout broke today",
    expectation:
      "Sends. Traffic is flat, but /checkout leaks far worse than its own norm — the leak alone carries it.",
    form: {
      siteId: "demo-bakery",
      period: "2026-08-23",
      visitors: 90,
      steps: [
        { path: "/", today: 90, typical: 88, clicks: 0 },
        { path: "/pricing", today: 50, typical: 50, clicks: 18 },
        { path: "/checkout", today: 20, typical: 20, clicks: 4 },
        { path: "/thank-you", today: 3, typical: 12, clicks: 0 },
      ],
      baselineVisitors: flat(88),
      useTypicalFunnel: true,
      conversions: "",
      typicalConversions: "",
      avgConversionTimeSec: 240,
    },
  },
  {
    name: "Quiet Tuesday",
    expectation:
      "Suppressed. The funnel is leaky, but it is leaky every day — nothing changed, so nothing is sent.",
    form: {
      siteId: "demo-bakery",
      period: "2026-08-23",
      visitors: 92,
      steps: [
        { path: "/", today: 92, typical: 90, clicks: 0 },
        { path: "/pricing", today: 52, typical: 51, clicks: 19 },
        { path: "/checkout", today: 21, typical: 20, clicks: 5 },
        { path: "/thank-you", today: 13, typical: 12, clicks: 0 },
      ],
      baselineVisitors: flat(90),
      useTypicalFunnel: true,
      conversions: "",
      typicalConversions: "",
      avgConversionTimeSec: 236,
    },
  },
  {
    name: "Tiny site, meaningless spike",
    expectation:
      "Suppressed. Visitors doubled, but on 12 sessions that is noise — the low-traffic guard holds the send.",
    form: {
      siteId: "solo-plumber",
      period: "2026-08-23",
      visitors: 12,
      steps: [
        { path: "/", today: 12, typical: 6, clicks: 0 },
        { path: "/services", today: 5, typical: 3, clicks: 2 },
        { path: "/contact", today: 2, typical: 1, clicks: 1 },
      ],
      baselineVisitors: flat(6),
      useTypicalFunnel: true,
      conversions: "",
      typicalConversions: "",
      avgConversionTimeSec: 0,
    },
  },
  {
    name: "Traffic surge",
    expectation:
      "Sends. Visitors are up well past the threshold on enough traffic to trust, and the funnel held its shape.",
    form: {
      siteId: "demo-bakery",
      period: "2026-08-23",
      visitors: 140,
      steps: [
        { path: "/", today: 140, typical: 90, clicks: 0 },
        { path: "/pricing", today: 78, typical: 51, clicks: 31 },
        { path: "/checkout", today: 31, typical: 20, clicks: 9 },
        { path: "/thank-you", today: 19, typical: 12, clicks: 0 },
      ],
      baselineVisitors: flat(90),
      useTypicalFunnel: true,
      conversions: "",
      typicalConversions: "",
      avgConversionTimeSec: 228,
    },
  },
  {
    name: "Orders collapsed",
    expectation:
      "Sends. Traffic is normal and the funnel looks ordinary, but orders halved against their own norm — the case the gate was blind to until conversions got a baseline.",
    form: {
      siteId: "demo-bakery",
      period: "2026-08-23",
      visitors: 400,
      steps: [
        { path: "/", today: 400, typical: 395, clicks: 0 },
        { path: "/pricing", today: 300, typical: 296, clicks: 96 },
        { path: "/checkout", today: 120, typical: 118, clicks: 34 },
        // The funnel is deliberately steady. Only the explicit order count moved,
        // so this preset isolates the conversions branch of the gate instead of
        // tripping the leak branch as well.
        { path: "/thank-you", today: 40, typical: 40, clicks: 0 },
      ],
      baselineVisitors: flat(395),
      useTypicalFunnel: true,
      conversions: "20",
      typicalConversions: "40",
      avgConversionTimeSec: 250,
    },
  },
  {
    name: "New site, no history",
    expectation:
      "Suppressed. The drop-off is real and gets reported, but with no history we cannot tell if it is new — so it never triggers a send on its own.",
    form: {
      siteId: "new-cafe",
      period: "2026-08-23",
      visitors: 80,
      steps: [
        { path: "/", today: 80, typical: 0, clicks: 0 },
        { path: "/menu", today: 44, typical: 0, clicks: 12 },
        { path: "/book", today: 15, typical: 0, clicks: 3 },
        { path: "/confirmed", today: 4, typical: 0, clicks: 0 },
      ],
      baselineVisitors: flat(78),
      useTypicalFunnel: false,
      conversions: "",
      typicalConversions: "",
      avgConversionTimeSec: 180,
    },
  },
];

/** Translate the form into the same DayShape the test suite builds scenarios from. */
export function toDayShape(form: BenchForm): Record<string, unknown> {
  const funnel: Record<string, number> = {};
  const clicks: Record<string, number> = {};
  const typical: Record<string, number> = {};

  for (const step of form.steps) {
    const path = step.path.trim();
    if (!path) continue;
    funnel[path] = step.today;
    if (step.clicks > 0) clicks[path] = step.clicks;
    typical[path] = step.typical;
  }

  const baselineVisitors = form.baselineVisitors
    .split(",")
    .map((n) => Number(n.trim()))
    .filter((n) => Number.isFinite(n));

  const conversions = form.conversions.trim();
  const typicalConversions = form.typicalConversions.trim();

  return {
    siteId: form.siteId,
    period: form.period,
    visitors: form.visitors,
    funnel,
    clicks: Object.keys(clicks).length > 0 ? clicks : undefined,
    baselineVisitors,
    baselineFunnel: form.useTypicalFunnel ? typical : undefined,
    conversions: conversions === "" ? undefined : Number(conversions),
    typicalConversions:
      typicalConversions === "" ? undefined : Number(typicalConversions),
    avgConversionTimeSec: form.avgConversionTimeSec,
  };
}
