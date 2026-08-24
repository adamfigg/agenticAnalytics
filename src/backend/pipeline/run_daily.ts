// Orchestrator. Chains the agents in order. The step numbering IS the reading order.
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
import type { Digest, Step1Bundle } from "../../shared/types";

export async function runDaily(parseInput: ParseInput): Promise<Digest> {
  // Input step: CSV -> typed data
  const data = parseCsvToSiteData(parseInput);

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
  const copy = await writeCopy(digest);
  digest.emailBody = buildEmail(digest, copy); // 3.1
  digest.smsBody = buildSms(copy);             // 3.2

  // TODO: delivery layer (Resend + Twilio). Real credentials, your side.
  // await deliver(digest)

  return digest;
}
