// The test bench API, mounted straight into Vite's dev server so the dashboard
// is still one command (`npm run dev`) and no server framework is pulled in.
//
// It runs the REAL pipeline: the same step 1 agents, the same suppression gate,
// the same single model call. Nothing here reimplements product behaviour — if
// the bench and production ever disagree, the bench is wrong.
//
// Dev-only by construction: this plugin is only applied when Vite runs a dev
// server, so it cannot leak into a production build.
import "../lib/env";
import type { Plugin } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";

import { anthropicBaseUrl, hasAnthropicKey } from "../lib/env";
import { sendEmail } from "../delivery/email";
import { renderEmailHtml } from "../delivery/email_template";
import { sendSms } from "../delivery/sms";
import { makeSiteData, type DayShape } from "../testing/fixtures";
import { runDailyFromSiteData } from "../pipeline/run_daily";
import { analyzeStats } from "../agents/step1/1_1_stats";
import { analyzeTrends } from "../agents/step1/1_2_trends";
import { analyzeFunnel } from "../agents/step1/1_3_funnel";
import { analyzeConversionTime } from "../agents/step1/1_4_conversion_time";
import { analyzeConversionCta } from "../agents/step1/1_5_conversion_cta";
import type { Digest, SiteData, Step1Bundle } from "../../shared/types";

export interface BenchResult {
  siteData: SiteData;
  /** What the deterministic agents computed, before the gate and the model. */
  step1: Step1Bundle;
  digest: Digest;
  /** True when a real model call actually succeeded. */
  usedModel: boolean;
  /** Where API calls are being sent — a proxy here explains most auth failures. */
  baseUrl: string;
  /** The exact HTML that would be emailed, so the bench previews the real thing. */
  emailHtml: string | null;
  elapsedMs: number;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) reject(new Error("payload too large"));
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

/** Validate just enough to return a useful message instead of a stack trace. */
function validate(shape: unknown): DayShape {
  if (typeof shape !== "object" || shape === null) {
    throw new Error("expected a scenario object");
  }
  const s = shape as Partial<DayShape>;
  if (typeof s.visitors !== "number" || !Number.isFinite(s.visitors)) {
    throw new Error("visitors must be a number");
  }
  if (typeof s.funnel !== "object" || s.funnel === null || Object.keys(s.funnel).length === 0) {
    throw new Error("funnel needs at least one step");
  }
  if (!Array.isArray(s.baselineVisitors) || s.baselineVisitors.length === 0) {
    throw new Error("baselineVisitors needs at least one prior day");
  }
  return s as DayShape;
}

async function runBench(shape: DayShape): Promise<BenchResult> {
  const started = Date.now();
  const siteData = makeSiteData(shape);

  // Recomputed here purely so the bench can SHOW the intermediate findings.
  // These are pure functions, so running them twice costs nothing and keeps
  // run_daily.ts free of bench-only plumbing.
  const step1: Step1Bundle = {
    stats: analyzeStats(siteData),
    trends: analyzeTrends(siteData),
    funnel: analyzeFunnel(siteData),
    conversionTime: analyzeConversionTime(siteData),
    conversionCta: analyzeConversionCta(siteData),
  };

  const digest = await runDailyFromSiteData(siteData);

  return {
    siteData,
    step1,
    digest,
    usedModel: digest.copySource === "model",
    baseUrl: anthropicBaseUrl(),
    emailHtml: digest.shouldSend ? renderEmailHtml(digest) : null,
    elapsedMs: Date.now() - started,
  };
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(payload);
}

export function benchApi(): Plugin {
  return {
    name: "smallbiz-bench-api",
    apply: "serve", // dev server only — never part of a production build
    configureServer(server) {
      server.middlewares.use("/api/bench", async (req, res, next) => {
        if (req.method !== "POST") return next();
        try {
          const shape = validate(JSON.parse(await readBody(req)));
          send(res, 200, await runBench(shape));
        } catch (err) {
          // Surface the real reason: a bench that hides its errors is useless.
          const message = err instanceof Error ? err.message : String(err);
          server.config.logger.error(`[bench] ${message}`);
          send(res, 400, { error: message });
        }
      });

      server.middlewares.use("/api/bench-env", (req, res, next) => {
        if (req.method !== "GET") return next();
        // Lets the UI say whether a run will hit the real model, and which
        // delivery channels are wired. Only presence is reported — no secret
        // ever leaves the server.
        send(res, 200, {
          hasApiKey: hasAnthropicKey(),
          baseUrl: anthropicBaseUrl(),
          emailConfigured: Boolean(process.env.RESEND_API_KEY?.trim()),
          smsConfigured: Boolean(
            process.env.TWILIO_ACCOUNT_SID?.trim() &&
              process.env.TWILIO_AUTH_TOKEN?.trim() &&
              process.env.TWILIO_FROM_NUMBER?.trim(),
          ),
        });
      });

      // Manual send. Deliberately explicit: the operator picks the channel and
      // types the recipient, and nothing is sent as a side effect of running a
      // scenario. Automatic delivery belongs in the nightly job, behind the
      // gate — not in a tool whose whole purpose is experimenting with numbers.
      server.middlewares.use("/api/send", async (req, res, next) => {
        if (req.method !== "POST") return next();
        try {
          const body = JSON.parse(await readBody(req)) as {
            channel?: unknown;
            to?: unknown;
            digest?: unknown;
          };

          const channel = body.channel;
          const to = typeof body.to === "string" ? body.to.trim() : "";
          if (channel !== "email" && channel !== "sms") {
            throw new Error("channel must be 'email' or 'sms'");
          }
          if (!to) throw new Error("a recipient is required");
          if (typeof body.digest !== "object" || body.digest === null) {
            throw new Error("run a scenario before sending");
          }

          const digest = body.digest as Digest;
          if (!digest.shouldSend) {
            throw new Error("this digest was suppressed — there is nothing to send");
          }

          const result =
            channel === "email" ? await sendEmail(digest, to) : await sendSms(digest, to);

          server.config.logger.info(
            `[send] ${channel} -> ${to}: ${result.ok ? "ok" : result.reason}`,
          );
          send(res, 200, result);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          server.config.logger.error(`[send] ${message}`);
          send(res, 400, { ok: false, configured: true, reason: message });
        }
      });
    },
  };
}
