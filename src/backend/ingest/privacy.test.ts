// The privacy promise, as executable checks.
//
// "No cookies, no visitor IDs, no raw event storage" is a sales claim we make in
// public and the reason customers need no cookie banner. A claim that only lives
// in a comment is one refactor away from being false, so it is asserted here.
// See CLAUDE.md -> "Hard constraints".
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { visitorHash, _rotateForTest } from "./salt";
import { createIngestHandler } from "./handler";
import { MemoryCounterStore } from "./store";
import { SqliteCounterStore } from "./sqlite_store";
import { HLL_REGISTERS } from "./hll";

const DAY = "2026-08-23";
const IP = "203.0.113.7";
const UA = "Mozilla/5.0 (test)";

describe("visitor identity", () => {
  test("the same person on the same day counts once", () => {
    // Distinct-visitor counting depends on this being stable within a day.
    _rotateForTest(DAY);
    assert.equal(visitorHash(IP, UA, DAY), visitorHash(IP, UA, DAY));
  });

  test("different people get different hashes", () => {
    _rotateForTest(DAY);
    const base = visitorHash(IP, UA, DAY);
    assert.notEqual(visitorHash("203.0.113.8", UA, DAY), base, "IP must matter");
    assert.notEqual(visitorHash(IP, "curl/8.0", DAY), base, "user-agent must matter");
  });

  test("ip and user-agent cannot be confused for one another", () => {
    // Without a domain separator, ("1.2.3", "4.5") and ("1.2.3.4", "5") would
    // hash identically. That would merge two unrelated visitors into one.
    _rotateForTest(DAY);
    assert.notEqual(visitorHash("1.2.3", "4.5", DAY), visitorHash("1.2.3.4", "5", DAY));
  });

  test("yesterday's visitor cannot be re-identified after the salt rotates", () => {
    // THE privacy claim. Once the salt is destroyed, the same person on the same
    // IP and browser is unrecognisable — we cannot link them across days, and we
    // cannot work backwards from a stored count to a person.
    _rotateForTest(DAY);
    const yesterday = visitorHash(IP, UA, DAY);

    _rotateForTest("2026-08-24"); // midnight: previous salt destroyed

    assert.notEqual(
      visitorHash(IP, UA, DAY),
      yesterday,
      "a destroyed salt must make yesterday's hash unreproducible",
    );
  });
});

describe("no raw event storage", () => {
  test("nothing identifying survives a request", async () => {
    const store = new MemoryCounterStore();
    const ingest = createIngestHandler({ store, today: () => DAY });

    await ingest(
      new Request("https://ingest.example.com/api/ingest", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": IP,
          "user-agent": UA,
        },
        body: JSON.stringify({
          site_id: "s1",
          events: [
            { type: "pageview", path: "/checkout" },
            { type: "click", path: "/checkout", element: "place-order" },
          ],
        }),
      }),
    );

    const day = await store.get("s1", DAY);
    assert.ok(day, "the day's counters should exist");

    // Everything that reached storage, as a single string.
    const stored = JSON.stringify(day);

    assert.ok(!stored.includes(IP), "the visitor's IP must not be stored");
    assert.ok(!stored.includes(UA), "the visitor's user-agent must not be stored");
    assert.ok(
      !stored.includes(visitorHash(IP, UA, DAY)),
      "the visitor hash must not be stored — only the count derived from it",
    );

    // What DID survive is counts.
    assert.equal(day!.visitors, 1);
    assert.equal(day!.pages["/checkout"]?.views, 1);
    assert.equal(day!.pages["/checkout"]?.clicks, 1);
  });

  test("malformed and oversized payloads are dropped, not stored", async () => {
    const store = new MemoryCounterStore();
    const ingest = createIngestHandler({ store, today: () => DAY });

    const res = await ingest(
      new Request("https://ingest.example.com/api/ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          site_id: "s1",
          events: [
            { type: "pageview" }, // no path
            { type: "exfiltrate", path: "/", note: "user@example.com" },
            { type: "click", path: "/", element: "x".repeat(500) },
            { type: "pageview", path: "/ok" },
          ],
        }),
      }),
    );

    assert.equal(res.status, 204);
    const day = await store.get("s1", DAY);
    assert.ok(!JSON.stringify(day).includes("user@example.com"));
    assert.deepEqual(Object.keys(day!.pages), ["/ok"], "only the valid event counted");
  });
});

describe("no visitor set exists anywhere", () => {
  test("the persisted sketch cannot contain a visitor hash", async () => {
    // Stronger than "we don't store the hash": there is nowhere for it to be.
    // The sketch is a fixed number of bytes of small register values regardless
    // of how many people visited, so it cannot encode a list of them.
    const store = new SqliteCounterStore(":memory:");

    for (let v = 0; v < 200; v++) {
      await store.record("s1", DAY, visitorHash(`198.51.100.${v}`, UA, DAY), [
        { type: "pageview", path: "/" },
      ]);
    }

    const sketch = store._visitorSketch("s1", DAY);
    assert.ok(sketch, "the open day should have a sketch");
    assert.equal(
      sketch!.length,
      HLL_REGISTERS,
      "sketch size is fixed, not proportional to visitors",
    );

    // Every byte is a register rank — a small integer, never hash material.
    const asHex = Buffer.from(sketch!).toString("hex");
    assert.ok(
      !asHex.includes(visitorHash("198.51.100.7", UA, DAY)),
      "no visitor hash can appear in the sketch",
    );

    // ...and it still counts, to within the sketch's ~1% tolerance.
    const counted = (await store.get("s1", DAY))?.visitors ?? 0;
    assert.ok(
      Math.abs(counted - 200) / 200 <= 0.02,
      `expected ~200 visitors, counted ${counted}`,
    );
    store.close();
  });
});

describe("retention", () => {
  for (const [name, make] of [
    ["memory", () => new MemoryCounterStore()],
    ["sqlite", () => new SqliteCounterStore(":memory:")],
  ] as const) {
    test(`aggregates older than 90 days are dropped (${name})`, async () => {
      const store = make();
      // 89 days ago is inside the window; 91 is outside it.
      for (const date of ["2026-05-26", "2026-05-24"]) {
        await store._seedClosed({
          siteId: "s1",
          date,
          visitors: 1,
          pages: {},
          conversions: 0,
          conversionTimeTotalSec: 0,
          conversionSamples: 0,
        });
      }

      const { daysDropped } = await store.prune(DAY);

      assert.equal(daysDropped, 1, "exactly the out-of-window day should go");
      assert.ok(await store.get("s1", "2026-05-26"), "89 days old must be kept");
      assert.equal(await store.get("s1", "2026-05-24"), undefined, "91 days old must go");
    });
  }

  test("closing a day discards its sketch but keeps its counts", async () => {
    // Once a day is over there is nothing left to count, so the sketch goes.
    // History costs a few integers per site-day, and a closed day can never be
    // recounted — which is the right trade in both directions.
    const store = new SqliteCounterStore(":memory:");

    await store.record("s1", "2026-08-22", visitorHash(IP, UA, "2026-08-22"), [
      { type: "pageview", path: "/" },
    ]);

    const { sketchesCleared } = await store.prune(DAY);

    assert.equal(sketchesCleared, 1);
    assert.equal(store._visitorSketch("s1", "2026-08-22"), null, "sketch discarded");
    assert.equal(
      (await store.get("s1", "2026-08-22"))?.visitors,
      1,
      "the count survives the sketch",
    );
    store.close();
  });
});
