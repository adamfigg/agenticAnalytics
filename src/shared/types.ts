// Shared contracts. Every agent and the frontend import from here.
// If you change a shape, the compiler tells you which agents break. That's the point.

// ---------- Input: parsed GA CSV ----------

export interface FunnelStepRaw {
  page: string;
  sessions: number;
}

export interface PageRow {
  page: string;
  views: number;
  sessions: number;
  avgTimeOnPageSec: number;
  clicks?: number; // optional CTA click count if present in export
}

export interface SiteData {
  siteId: string;
  period: string; // ISO date, the day this data covers
  totalVisitors: number;
  pages: PageRow[];
  funnelSteps: FunnelStepRaw[]; // ordered: landing -> ... -> purchase
  conversions: number;
  avgConversionTimeSec: number;
  // Rolling context for delta/anomaly work. 14 prior daily visitor counts, oldest first.
  baselineVisitors: number[];
  /**
   * Prior days' funnel sessions, oldest first, each in the same step order as
   * `funnelSteps`. Without this we cannot tell a funnel that BROKE today from
   * one that always looked this way, so drop-off alone can never trigger a send.
   * Absent for CSV imports, which carry a single day.
   */
  baselineFunnels?: FunnelStepRaw[][];
}

// ---------- Step 1 outputs (deterministic) ----------

export interface StatsResult {
  totalVisitors: number;
  totalConversions: number;
  conversionRatePct: number;
  visitorsDeltaPct: number; // vs baseline mean
}

export interface TrendsResult {
  highTrafficPages: { page: string; views: number }[];
  lowTrafficPages: { page: string; views: number }[];
  overallDirection: "up" | "down" | "flat";
}

export interface FunnelStepResult {
  page: string;
  entered: number;
  dropoffPct: number;
  /** This step's mean drop-off across the baseline window; undefined without one. */
  baselineDropoffPct?: number;
  /** Percentage points worse than usual. Positive means today is unusually leaky. */
  elevationPct?: number;
}

export interface FunnelResult {
  steps: FunnelStepResult[];
  biggestLeak: FunnelStepResult;
}

export interface ConversionTimeResult {
  avgConversionTimeSec: number;
  deltaPct: number; // vs baseline; positive = slower
}

export interface ConversionCtaResult {
  bestCta: { page: string; clicks: number; ctr: number } | null;
  worstCta: { page: string; clicks: number; ctr: number } | null;
}

export interface Step1Bundle {
  stats: StatsResult;
  trends: TrendsResult;
  funnel: FunnelResult;
  conversionTime: ConversionTimeResult;
  conversionCta: ConversionCtaResult;
}

// ---------- Step 2 output: the digest object ----------
// Single source of truth. Every delivery channel renders from this.

export interface Metric {
  label: string;
  value: number;
  deltaPct: number;
}

export interface Leak {
  page: string;
  element?: string;
  detail: string;
  severity: "low" | "medium" | "high";
}

export interface Win {
  page: string;
  detail: string;
}

export interface Digest {
  siteId: string;
  period: string;
  headline: string;
  metrics: Metric[];
  leak: Leak | null;
  win: Win | null;
  narrative: string; // filled by step 3
  shouldSend: boolean; // computed in step 2, BEFORE any model call
  // Copy produced by step 3, one model call fills both:
  emailBody?: string;
  smsBody?: string;
}

// ---------- Step 3: the single model call returns this ----------

export interface CopyBundle {
  emailNarrative: string;
  smsLine: string;
}
