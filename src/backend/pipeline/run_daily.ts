// Orchestrator. Chains the agents in order. The step numbering IS the reading order.
import "../lib/env";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseCsvToSiteData, type ParseInput } from "../lib/parse_csv";
import { analyzeStats } from "../agents/step1/1_1_stats";
import { analyzeTrends } from "../agents/step1/1_2_trends";
import { analyzeFunnel } from "../agents/step1/1_3_funnel";
import { analyzeConversionTime } from "../agents/step1/1_4_conversion_time";
import { analyzeConversionCta } from "../agents/step1/1_5_conversion_cta";
import { compose } from "../agents/step2/2_1_compose";
import { writeCopy } from "../agents/step3/copy";
import { buildEmail } from "../agents/step3/3_1_email";
import { buildSms } from "../agents/step3/3_2_sms";
import type { Digest, SiteData, Step1Bundle } from "../../shared/types";

/** Input path A: a Google Analytics CSV export. */
export async function runDaily(parseInput: ParseInput): Promise<Digest> {
  return runDailyFromSiteData(parseCsvToSiteData(parseInput));
}

/**
 * The pipeline proper, from typed data onward. Both input paths converge here:
 * `runDaily` for a CSV import, and live tracking via `buildSiteData` in
 * ../ingest/to_site_data.ts. Neither can influence anything below this line.
 */
export async function runDailyFromSiteData(data: SiteData): Promise<Digest> {
  // Step 1 — deterministic analysis (no model calls)
  const step1: Step1Bundle = {
    stats: analyzeStats(data),               // 1.1
    trends: analyzeTrends(data),             // 1.2
    funnel: analyzeFunnel(data),             // 1.3
    conversionTime: analyzeConversionTime(data), // 1.4
    conversionCta: analyzeConversionCta(data),   // 1.5
  };

  // Step 2 — compose digest + suppression gate
  const digest = compose({ siteId: data.siteId, period: data.period, step1 }); // 2.1

  // Gate: nothing moved? Never reach the model. Queue for the weekly instead.
  if (!digest.shouldSend) {
    // TODO: queueForWeekly(digest)
    return digest;
  }

  // Step 3 — ONE model call writes both channels
  const written = await writeCopy(digest);
  const copy = written.copy;
  digest.copySource = written.source;
  digest.copyReason = written.reason;
  // The digest object is the single source of truth — the dashboard renders
  // `narrative`, so it must be filled here, not just the channel bodies.
  digest.narrative = copy.emailNarrative;
  digest.emailBody = buildEmail(digest, copy); // 3.1
  digest.smsBody = buildSms(copy);             // 3.2

  // TODO: delivery layer (Resend + Twilio). Real credentials, your side.
  // await deliver(digest)

  return digest;
}

// ---------------------------------------------------------------------------
// CLI entry: `npm run pipeline`. Runs one day against the committed fixture so
// the pipeline is demonstrable with no database and no external accounts.
// ---------------------------------------------------------------------------
const isMain =
  process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const here = dirname(fileURLToPath(import.meta.url));
  const digest = await runDaily({
    csv: readFileSync(join(here, "../fixtures/sample_day.csv"), "utf8"),
    siteId: "demo-bakery",
    period: "2026-08-23",
    funnelOrder: ["/", "/pricing", "/checkout", "/thank-you"],
    baselineVisitors: [
      680, 712, 695, 704, 688, 731, 699, 706, 690, 715, 702, 684, 720, 694,
    ],
  });
  console.log(JSON.stringify(digest, null, 2));
  if (!digest.shouldSend) {
    console.log("\nSuppressed: nothing moved enough to send. Queued for the weekly.");
  }
}
