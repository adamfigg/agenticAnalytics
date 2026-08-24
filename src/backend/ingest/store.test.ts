// One conformance suite, run against both stores.
//
// The in-memory store is what every other test and the demo run against, so it
// is only useful if it behaves exactly like the durable one. Running the same
// assertions over both is what keeps that true — a divergence would otherwise
// show up for the first time in production.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CounterStore, MemoryCounterStore, shiftDate } from "./store";
import { SqliteCounterStore } from "./sqlite_store";

const DAY = "2026-08-23";
const who = (name: string): string => createHash("sha256").update(name).digest("hex");

interface Seedable extends CounterStore {
  _seedClosed(day: Parameters<MemoryCounterStore["_seedClosed"]>[0]): Promise<void>;
}

const BACKENDS: [string, () => Seedable][] = [
  ["memory", () => new MemoryCounterStore()],
  ["sqlite", () => new SqliteCounterStore(":memory:")],
];

for (const [name, make] of BACKENDS) {
  describe(`CounterStore conformance (${name})`, () => {
    test("records events and reads back counts", async () => {
      const store = make();

      await store.record("s1", DAY, who("a"), [
        { type: "pageview", path: "/" },
        { type: "click", path: "/", element: "cta" },
        { type: "engagement", path: "/", seconds: 40 },
      ]);

      const day = await store.get("s1", DAY);
      assert.equal(day?.visitors, 1);
      assert.equal(day?.pages["/"]?.views, 1);
      assert.equal(day?.pages["/"]?.clicks, 1);
      assert.equal(day?.pages["/"]?.timeOnPageTotalSec, 40);
      assert.equal(day?.pages["/"]?.timeSamples, 1);
    });

    test("counts a returning visitor once across separate requests", async () => {
      // Each beacon is its own HTTP request, so the store — not the caller —
      // has to be the thing that remembers. This is the assertion that the old
      // in-process dedupe map used to be responsible for.
      const store = make();

      for (let i = 0; i < 4; i++) {
        await store.record("s1", DAY, who("same-person"), [
          { type: "pageview", path: "/pricing" },
        ]);
      }
      await store.record("s1", DAY, who("someone-else"), [
        { type: "pageview", path: "/pricing" },
      ]);

      const day = await store.get("s1", DAY);
      assert.equal(day?.visitors, 2, "two people");
      assert.equal(day?.pages["/pricing"]?.views, 5, "five views between them");
      assert.equal(day?.pages["/pricing"]?.sessions, 2, "two distinct sessions");
    });

    test("keeps sites separate", async () => {
      const store = make();
      await store.record("s1", DAY, who("a"), [{ type: "pageview", path: "/" }]);
      await store.record("s2", DAY, who("b"), [{ type: "pageview", path: "/" }]);

      assert.equal((await store.get("s1", DAY))?.visitors, 1);
      assert.equal((await store.get("s2", DAY))?.visitors, 1);
    });

    test("an unrecorded day is absent, not empty", async () => {
      // buildSiteData relies on this to skip a site rather than send a digest
      // full of zeroes.
      const store = make();
      assert.equal(await store.get("s1", DAY), undefined);
    });

    test("baseline returns prior days oldest-first and skips gaps", async () => {
      const store = make();

      // Three of the last five days have data; two are missing entirely.
      for (const offset of [1, 3, 5]) {
        await store._seedClosed({
          siteId: "s1",
          date: shiftDate(DAY, -offset),
          visitors: offset * 10,
          pages: {},
          conversions: 0,
          conversionTimeTotalSec: 0,
          conversionSamples: 0,
        });
      }

      const baseline = await store.baseline("s1", DAY, 5);

      assert.deepEqual(
        baseline.map((d) => d.date),
        [shiftDate(DAY, -5), shiftDate(DAY, -3), shiftDate(DAY, -1)],
        "oldest first, gaps omitted",
      );
    });

    test("baseline excludes the day being reported on", async () => {
      // Comparing a day against itself would flatten every delta to zero and the
      // gate would never fire.
      const store = make();
      await store.record("s1", DAY, who("today"), [{ type: "pageview", path: "/" }]);

      const baseline = await store.baseline("s1", DAY, 14);
      assert.ok(
        !baseline.some((d) => d.date === DAY),
        "today must not appear in its own baseline",
      );
    });
  });
}

describe("durability", () => {
  const dbPath = join(tmpdir(), `smallbiz-store-test-${randomUUID()}.db`);
  after(() => rmSync(dbPath, { force: true }));

  test("counters survive closing and reopening the database", async () => {
    // The whole reason this store exists. The in-memory version fails this by
    // construction, which is why it can never be what runs in production.
    const first = new SqliteCounterStore(dbPath);
    for (let v = 0; v < 25; v++) {
      await first.record("s1", DAY, who(`v${v}`), [{ type: "pageview", path: "/pricing" }]);
    }
    const before = await first.get("s1", DAY);
    first.close();

    const second = new SqliteCounterStore(dbPath);
    const after_ = await second.get("s1", DAY);
    second.close();

    assert.equal(before?.visitors, 25);
    assert.deepEqual(after_, before, "everything survived the restart unchanged");
  });

  test("a reopened day keeps counting the same visitors correctly", async () => {
    // The sketch has to survive too, not just the totals — otherwise a deploy
    // mid-day would double-count everyone who came back afterwards.
    const path = join(tmpdir(), `smallbiz-store-test-${randomUUID()}.db`);
    try {
      const first = new SqliteCounterStore(path);
      for (const name of ["a", "b", "c"]) {
        await first.record("s1", DAY, who(name), [{ type: "pageview", path: "/" }]);
      }
      first.close();

      // Same three people come back after the restart.
      const second = new SqliteCounterStore(path);
      for (const name of ["a", "b", "c"]) {
        await second.record("s1", DAY, who(name), [{ type: "pageview", path: "/" }]);
      }
      const day = await second.get("s1", DAY);
      second.close();

      assert.equal(day?.visitors, 3, "still three people, not six");
      assert.equal(day?.pages["/"]?.views, 6, "but six views");
    } finally {
      rmSync(path, { force: true });
    }
  });
});
