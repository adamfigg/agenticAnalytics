// Aggregation. Views count every time; sessions count a person once. Getting
// this wrong quietly corrupts every downstream number, including the funnel the
// whole product reports on.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { applyEvent, materialize, newDayState } from "./counters";
import { HLL_REGISTERS, emptySketch, sketchAdd } from "./hll";

const DAY = "2026-08-23";

/** A realistic visitor hash — the sketch reads the digest's bits directly. */
const who = (name: string): string =>
  createHash("sha256").update(name).digest("hex");

describe("counter aggregation", () => {
  test("one person refreshing a page is many views but one session", () => {
    const state = newDayState("s1", DAY);

    for (let i = 0; i < 5; i++) {
      applyEvent(state, { type: "pageview", path: "/pricing" }, who("a"));
    }

    const day = materialize(state);
    assert.equal(day.pages["/pricing"]?.views, 5, "every view counts");
    assert.equal(day.pages["/pricing"]?.sessions, 1, "the person counts once");
    assert.equal(day.visitors, 1);
  });

  test("one person visiting three pages is one site visitor", () => {
    // The funnel depends on this: someone who walks / -> /pricing -> /checkout
    // is one visitor who reached three steps, not three visitors.
    const state = newDayState("s1", DAY);

    for (const path of ["/", "/pricing", "/checkout"]) {
      applyEvent(state, { type: "pageview", path }, who("a"));
    }

    const day = materialize(state);
    assert.equal(day.visitors, 1, "distinct site visitors");
    assert.equal(day.pages["/"]?.sessions, 1);
    assert.equal(day.pages["/pricing"]?.sessions, 1);
    assert.equal(day.pages["/checkout"]?.sessions, 1);
  });

  test("different people on the same page each count", () => {
    const state = newDayState("s1", DAY);

    for (const name of ["a", "b", "c"]) {
      applyEvent(state, { type: "pageview", path: "/" }, who(name));
    }

    const day = materialize(state);
    assert.equal(day.visitors, 3);
    assert.equal(day.pages["/"]?.sessions, 3);
  });

  test("a realistic day of traffic counts within tolerance", () => {
    // Distinct visitors are estimated from a sketch, not counted from a list —
    // that is the trade that lets us hold no visitor set at all. The estimate is
    // within ~1%, so a 240-visitor day may report 238. Small businesses will
    // never notice; a customer cross-checking against another tool will see a
    // smaller discrepancy than those tools have with each other.
    //
    // If this ever fails, the sketch is broken, not merely imprecise.
    const state = newDayState("s1", DAY);

    const actual = 240;
    for (let v = 0; v < actual; v++) {
      applyEvent(state, { type: "pageview", path: "/" }, who(`visitor-${v}`));
    }

    const counted = materialize(state).visitors;
    const errorPct = (Math.abs(counted - actual) / actual) * 100;
    assert.ok(errorPct <= 2, `counted ${counted} for ${actual} visitors (${errorPct.toFixed(1)}% off)`);
  });

  test("every register is reachable at the configured precision", () => {
    // Guards a subtle failure mode: the register index is carved out of the
    // visitor hash, and if that extraction stops matching HLL_PRECISION, most
    // registers become unreachable and every count silently goes wrong while
    // the small-cardinality tests above keep passing.
    const sketch = emptySketch();
    for (let v = 0; v < HLL_REGISTERS * 12; v++) {
      sketchAdd(sketch, who(`reach-${v}`));
    }

    const touched = sketch.filter((r) => r > 0).length;
    assert.equal(touched, HLL_REGISTERS, "all registers must be reachable");
  });

  test("implausible engagement times are ignored, not averaged in", () => {
    // A tab left open for a week would otherwise wreck the average time on page.
    const state = newDayState("s1", DAY);

    applyEvent(state, { type: "engagement", path: "/", seconds: 45 }, who("a"));
    applyEvent(state, { type: "engagement", path: "/", seconds: 999_999 }, who("b"));
    applyEvent(state, { type: "engagement", path: "/", seconds: -10 }, who("c"));

    const day = materialize(state);
    assert.equal(day.pages["/"]?.timeSamples, 1, "only the plausible sample counts");
    assert.equal(day.pages["/"]?.timeOnPageTotalSec, 45);
  });

  test("conversions are counted separately from pageviews", () => {
    const state = newDayState("s1", DAY);

    applyEvent(state, { type: "pageview", path: "/thank-you" }, who("a"));
    applyEvent(state, { type: "convert", path: "/thank-you", seconds: 300 }, who("a"));

    const day = materialize(state);
    assert.equal(day.conversions, 1);
    assert.equal(day.conversionSamples, 1);
    assert.equal(day.conversionTimeTotalSec, 300);
    assert.equal(day.visitors, 1, "converting does not make someone a second visitor");
  });
});
