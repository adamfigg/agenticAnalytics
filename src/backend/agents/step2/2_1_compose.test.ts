// The suppression gate. This is the product's one decision, made nightly, per
// customer: do we send this person an email today?
//
// Every test here is named as a business scenario, because that is the level the
// decision is actually right or wrong at. A digest that arrives every day gets
// filtered to a folder in three weeks — so a false positive here is not a cosmetic
// bug, it is the product failing. See CLAUDE.md -> "Suppression rule".
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { analyzeStats } from "../step1/1_1_stats";
import { analyzeTrends } from "../step1/1_2_trends";
import { analyzeFunnel } from "../step1/1_3_funnel";
import { analyzeConversionTime } from "../step1/1_4_conversion_time";
import { analyzeConversionCta } from "../step1/1_5_conversion_cta";
import { compose } from "./2_1_compose";
import { makeSiteData, flatBaseline, type DayShape } from "../../testing/fixtures";
import type { Digest } from "../../../shared/types";

/** Run the real step 1 -> step 2 chain, exactly as the orchestrator does. */
function digestFor(shape: DayShape): Digest {
  const data = makeSiteData(shape);
  return compose({
    siteId: data.siteId,
    period: data.period,
    step1: {
      stats: analyzeStats(data),
      trends: analyzeTrends(data),
      funnel: analyzeFunnel(data),
      conversionTime: analyzeConversionTime(data),
      conversionCta: analyzeConversionCta(data),
    },
  });
}

describe("suppression gate", () => {
  test("a quiet day sends nothing", () => {
    // Traffic flat against baseline, funnel shallow and unremarkable. There is
    // no news here, so the owner should hear nothing and we should pay for no
    // model call.
    const digest = digestFor({
      visitors: 100,
      funnel: { "/": 100, "/pricing": 80, "/checkout": 62, "/thank-you": 50 },
      baselineVisitors: flatBaseline(98),
    });

    assert.equal(digest.shouldSend, false, "flat day must not trigger a send");
  });

  test("a tiny site's meaningless spike sends nothing", () => {
    // The plumber with 12 visitors a day. Going 2 -> 4 conversions is +100% and
    // tells the owner precisely nothing. Percentage deltas on tiny numbers are
    // noise, and this is the guard CLAUDE.md's open question is about.
    const digest = digestFor({
      visitors: 12,
      funnel: { "/": 12, "/contact": 6, "/booked": 4 },
      baselineVisitors: flatBaseline(6),
    });

    assert.equal(
      digest.shouldSend,
      false,
      "a 12-visitor site must not fire on a percentage swing",
    );
  });

  test("a real traffic jump on real traffic sends", () => {
    // 90 visitors against a 70 baseline is +28% on a sample big enough to trust.
    // This is the case the product exists for.
    const digest = digestFor({
      visitors: 90,
      funnel: { "/": 90, "/pricing": 50, "/checkout": 20, "/thank-you": 6 },
      baselineVisitors: flatBaseline(70),
    });

    assert.equal(digest.shouldSend, true, "a trustworthy 28% jump must send");
    assert.equal(digest.metrics[0]?.label, "Visitors");
    assert.ok(digest.metrics[0]!.deltaPct > 15);
  });

  test("a funnel that always leaks here is not news", () => {
    // The shape most likely to break the product. This bakery loses 70% of
    // visitors at /checkout every single day — that is simply what their funnel
    // looks like, not something that changed. Traffic is flat.
    //
    // If this sends, it sends EVERY day, and the digest becomes the daily noise
    // CLAUDE.md is written to prevent.
    const alwaysLeaky = { "/": 100, "/pricing": 70, "/checkout": 60, "/thank-you": 18 };

    const digest = digestFor({
      visitors: 100,
      funnel: alwaysLeaky,
      baselineFunnel: alwaysLeaky, // today looks exactly like every other day
      baselineVisitors: flatBaseline(100),
    });

    assert.equal(
      digest.shouldSend,
      false,
      "a permanently deep funnel step is the site's normal shape, not a finding",
    );
  });

  test("a funnel that broke today sends, even on flat traffic", () => {
    // The mirror image, and the case the whole product is for. Traffic is
    // unchanged, so a visitor-count check alone would see nothing — but
    // /checkout normally loses 45% of visitors and today it lost 79%. Something
    // broke, and the owner needs to hear about it this morning.
    const digest = digestFor({
      visitors: 100,
      funnel: { "/": 100, "/pricing": 70, "/checkout": 62, "/thank-you": 13 },
      baselineFunnel: { "/": 100, "/pricing": 70, "/checkout": 62, "/thank-you": 34 },
      baselineVisitors: flatBaseline(100),
    });

    assert.equal(digest.shouldSend, true, "a newly broken funnel step must send");
    assert.equal(digest.leak?.page, "/checkout");
    assert.equal(digest.leak?.severity, "high");
    assert.match(
      digest.leak!.detail,
      /up from/,
      "the detail must contrast today against normal, or the owner can't judge it",
    );
  });

  test("a site with no funnel history yet stays quiet", () => {
    // Week one, or a site coming back from an outage: the baseline days recorded
    // no sessions at that step. A zero-traffic day has a 0% drop-off by
    // definition, and counting it would make an ordinary funnel look like a
    // collapse. Drop-off with no usable history must never trigger a send.
    const digest = digestFor({
      visitors: 100,
      funnel: { "/": 100, "/pricing": 70, "/checkout": 60, "/thank-you": 18 },
      baselineFunnel: { "/": 0, "/pricing": 0, "/checkout": 0, "/thank-you": 0 },
      baselineVisitors: flatBaseline(100),
    });

    assert.equal(
      digest.shouldSend,
      false,
      "empty baseline days must not manufacture an elevation",
    );
    assert.notEqual(
      digest.leak?.severity,
      "high",
      "a leak we cannot compare against history is not send-worthy on its own",
    );
  });

  test("the leak names the page the owner has to go look at", () => {
    // The narrative is worthless if it can't say where to look. When a leak is
    // reported at all, it must carry the actual path.
    const digest = digestFor({
      visitors: 90,
      funnel: { "/": 90, "/pricing": 70, "/checkout": 60, "/thank-you": 12 },
      baselineVisitors: flatBaseline(70),
    });

    if (digest.leak) {
      assert.ok(
        digest.leak.page.startsWith("/"),
        `leak.page must be a real path, got ${JSON.stringify(digest.leak.page)}`,
      );
      assert.ok(
        digest.leak.detail.includes(digest.leak.page),
        "leak.detail must name the page so the owner knows where to go",
      );
    }
  });

  test("orders collapsing on steady traffic sends", () => {
    // The scenario the gate was blind to until conversions got a baseline. Same
    // visitors as always, funnel shape unremarkable, but orders fell by half.
    // For a small business this is the single most expensive thing to miss.
    const digest = digestFor({
      visitors: 400,
      funnel: { "/": 400, "/pricing": 300, "/checkout": 120, "/thank-you": 20 },
      baselineVisitors: flatBaseline(395),
      typicalConversions: 40,
      conversions: 20,
    });

    assert.equal(digest.shouldSend, true, "a 50% drop in orders must send");
    const conversions = digest.metrics.find((m) => m.label === "Conversions");
    assert.equal(conversions?.deltaPct, -50);
  });

  test("orders holding steady stays quiet", () => {
    // Same site, ordinary day. The conversion metric now has a real baseline, so
    // this must be quiet for the right reason rather than by accident.
    const digest = digestFor({
      visitors: 400,
      funnel: { "/": 400, "/pricing": 300, "/checkout": 120, "/thank-you": 41 },
      baselineVisitors: flatBaseline(395),
      typicalConversions: 40,
      conversions: 41,
    });

    assert.equal(digest.shouldSend, false, "orders within noise must not send");
  });

  test("a handful of orders swinging wildly stays quiet", () => {
    // Three orders becoming one is -67%, and means nothing. The volume floor has
    // to hold here or every low-traffic customer gets a daily email.
    const digest = digestFor({
      visitors: 200,
      funnel: { "/": 200, "/pricing": 90, "/checkout": 20, "/thank-you": 1 },
      baselineVisitors: flatBaseline(198),
      typicalConversions: 3,
      conversions: 1,
    });

    assert.equal(
      digest.shouldSend,
      false,
      "a percentage swing on 3 orders a day is noise, not news",
    );
  });

  test("a site with no conversion history cannot be judged on orders", () => {
    // No typicalConversions supplied. The metric still renders, but a missing
    // baseline must never be read as "orders held steady".
    const digest = digestFor({
      visitors: 400,
      funnel: { "/": 400, "/pricing": 300, "/checkout": 120, "/thank-you": 2 },
      baselineVisitors: flatBaseline(398),
    });

    assert.equal(digest.shouldSend, false, "no history means no conversion verdict");
  });

  test("a two-visitor site is told about no bright spot at all", () => {
    // Every step tied at 2 sessions. There is no busiest page, nothing rose, and
    // nothing here is good news. Claiming a bright spot on this data is a lie the
    // owner can check in five seconds, and it costs us their trust in everything
    // else the digest says.
    const digest = digestFor({
      visitors: 2,
      funnel: { "/": 2, "/pricing": 2, "/checkout": 2, "/thank-you": 2 },
      baselineVisitors: flatBaseline(2),
      baselineFunnel: { "/": 2, "/pricing": 2, "/checkout": 2, "/thank-you": 2 },
    });

    assert.equal(digest.win, null, "a tie on 2 visitors is not a bright spot");
  });

  test("the busiest page is not, on its own, a win", () => {
    // A perfectly ordinary day on a real site. The landing page drew the most
    // traffic, as it does every single day. That is not news.
    const digest = digestFor({
      visitors: 400,
      funnel: { "/": 400, "/pricing": 300, "/checkout": 120, "/thank-you": 40 },
      baselineVisitors: flatBaseline(398),
      baselineFunnel: { "/": 398, "/pricing": 299, "/checkout": 119, "/thank-you": 40 },
    });

    assert.equal(digest.win, null, "busiest-page-as-usual must not report a win");
  });

  test("a page that genuinely rose is reported as the win", () => {
    // Pricing traffic up by half against its own norm. This is the shape of win
    // CLAUDE.md's example digest describes.
    const digest = digestFor({
      visitors: 430,
      funnel: { "/": 400, "/pricing": 450, "/checkout": 120, "/thank-you": 40 },
      baselineVisitors: flatBaseline(420),
      baselineFunnel: { "/": 398, "/pricing": 300, "/checkout": 119, "/thank-you": 40 },
    });

    assert.equal(digest.win?.page, "/pricing");
    assert.match(digest.win?.detail ?? "", /up 50%/);
  });

  test("a rise on a page nobody visits is not a win", () => {
    // 2 -> 5 sessions is +150% and completely meaningless. The volume floor has
    // to hold here for the same reason it does on the gate.
    const digest = digestFor({
      visitors: 400,
      funnel: { "/": 400, "/pricing": 300, "/checkout": 120, "/tiny": 5 },
      baselineVisitors: flatBaseline(398),
      baselineFunnel: { "/": 398, "/pricing": 299, "/checkout": 119, "/tiny": 2 },
    });

    assert.equal(digest.win, null, "a rise on 2 sessions a day is noise");
  });

  test("no model call is implied on a suppressed day", () => {
    // The gate is computed BEFORE the model runs, so a suppressed digest must
    // arrive with its copy fields still empty. If narrative were populated here,
    // we'd be paying for quiet days.
    const digest = digestFor({
      visitors: 100,
      funnel: { "/": 100, "/pricing": 80, "/checkout": 62, "/thank-you": 50 },
      baselineVisitors: flatBaseline(98),
    });

    assert.equal(digest.shouldSend, false);
    assert.equal(digest.narrative, "", "narrative must be unset before step 3");
    assert.equal(digest.emailBody, undefined);
    assert.equal(digest.smsBody, undefined);
  });
});
