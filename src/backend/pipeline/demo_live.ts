// Live-tracking demo: synthetic browser traffic -> ingest handler -> SQLite ->
// SiteData -> the same pipeline the CSV path uses. Runs with no server and no
// API key, so the whole shape is verifiable in one command.
//
// The last step reopens the database from disk to show the counters actually
// survived the process, which is the entire point of the durable store.
//
//   npm run demo
import "../lib/env";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createIngestHandler } from "../ingest/handler";
import { SqliteCounterStore } from "../ingest/sqlite_store";
import { shiftDate } from "../ingest/store";
import { visitorHash } from "../ingest/salt";
import { buildSiteData } from "../ingest/to_site_data";
import { runDailyFromSiteData } from "./run_daily";

const SITE = "demo-bakery";
const PERIOD = "2026-08-23";
const FUNNEL = ["/", "/pricing", "/checkout", "/thank-you"];
const DB_PATH = join(tmpdir(), "smallbiz-analytics-demo.db");

/** Post events the way the tracking snippet would, from one synthetic visitor. */
function beaconFor(ingest: (req: Request) => Promise<Response>) {
  return (visitorNo: number, events: unknown[]) =>
    ingest(
      new Request("https://ingest.example.com/api/ingest", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          // Distinct IP + UA per visitor is what makes the daily hash distinct.
          "x-forwarded-for": `203.0.113.${visitorNo % 254}`,
          "user-agent": `Mozilla/5.0 (demo visitor ${visitorNo})`,
        },
        body: JSON.stringify({ site_id: SITE, events }),
      }),
    );
}

async function main(): Promise<void> {
  rmSync(DB_PATH, { force: true }); // fresh run every time
  const store = new SqliteCounterStore(DB_PATH);
  const beacon = beaconFor(createIngestHandler({ store, today: () => PERIOD }));

  // 14 prior days of baseline: ~70 visitors a day, carrying the site's usual
  // funnel shape. The funnel history is what lets the gate tell a step that
  // broke from one that always looked this way.
  const USUAL: Record<string, number> = {
    "/": 70,
    "/pricing": 40,
    "/checkout": 16,
    "/thank-you": 5,
  };
  for (let i = 14; i >= 1; i--) {
    const date = shiftDate(PERIOD, -i);
    await store._seedClosed({
      siteId: SITE,
      date,
      visitors: 64 + ((i * 7) % 13),
      pages: Object.fromEntries(
        Object.entries(USUAL).map(([path, sessions]) => [
          path,
          {
            views: Math.round(sessions * 1.2),
            sessions,
            clicks: 0,
            timeOnPageTotalSec: sessions * 38,
            timeSamples: sessions,
          },
        ]),
      ),
      conversions: USUAL["/thank-you"]!,
      conversionTimeTotalSec: 0,
      conversionSamples: 0,
    });
  }

  // Today: 90 visitors land, and the funnel narrows.
  const REACH: Record<string, number> = {
    "/": 90,
    "/pricing": 50,
    "/checkout": 20,
    "/thank-you": 6,
  };
  for (const [path, count] of Object.entries(REACH)) {
    for (let v = 1; v <= count; v++) {
      await beacon(v, [
        { type: "pageview", path },
        { type: "engagement", path, seconds: 30 + (v % 20) },
      ]);
    }
  }
  for (let v = 1; v <= 18; v++) {
    await beacon(v, [{ type: "click", path: "/pricing", element: "start-order" }]);
  }

  const data = await buildSiteData({ store, siteId: SITE, period: PERIOD, funnelOrder: FUNNEL });
  if (!data) {
    console.error("No counters for that period — nothing to report.");
    return;
  }

  console.log(
    `Ingested ${data.totalVisitors} distinct visitors across ${data.pages.length} pages.`,
  );
  console.log("Funnel:", data.funnelSteps.map((s) => `${s.page}=${s.sessions}`).join("  "));

  const digest = await runDailyFromSiteData(data);
  console.log("\n--- digest ---");
  console.log(JSON.stringify(digest, null, 2));

  const { daysDropped, sketchesCleared } = await store.prune(PERIOD);
  console.log(
    `\nHousekeeping: ${daysDropped} days past retention dropped, ${sketchesCleared} sketches cleared.`,
  );
  store.close();

  // The point of all this: reopen from disk and the counts are still there.
  const reopened = new SqliteCounterStore(DB_PATH);
  const survived = await reopened.get(SITE, PERIOD);
  console.log(
    `After restart: ${survived?.visitors ?? 0} visitors still on disk at ${DB_PATH}`,
  );
  reopened.close();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
