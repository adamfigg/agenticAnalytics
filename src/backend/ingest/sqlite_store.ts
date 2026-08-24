// The durable store: SQLite via node:sqlite, which ships with Node and costs no
// dependency. Counters survive restarts and deploys, which the in-memory store
// never did.
//
// Migrating to Turso later is a driver swap, not a rewrite: the SQL below is
// ordinary SQLite, and everything above this file talks to `CounterStore`.
//
// What is stored is counts and HLL sketches. No visitor hash, IP or user-agent
// is ever written — see `hll.ts` for why the sketch is safe to persist.
import { DatabaseSync } from "node:sqlite";
import {
  DayCounters,
  DayState,
  PageCounters,
  RawEvent,
  applyEvent,
  newDayState,
  newPageState,
} from "./counters";
import { emptySketch, sketchCount } from "./hll";
import { CounterStore, PruneResult, RETENTION_DAYS, shiftDate } from "./store";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS day_counters (
  site_id                   TEXT    NOT NULL,
  date                      TEXT    NOT NULL,
  visitors                  INTEGER NOT NULL DEFAULT 0,
  -- NULL once the day has closed: the count stays, the sketch is discarded.
  visitors_sketch           BLOB,
  conversions               INTEGER NOT NULL DEFAULT 0,
  conversion_time_total_sec INTEGER NOT NULL DEFAULT 0,
  conversion_samples        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (site_id, date)
);

CREATE TABLE IF NOT EXISTS page_counters (
  site_id        TEXT    NOT NULL,
  date           TEXT    NOT NULL,
  path           TEXT    NOT NULL,
  views          INTEGER NOT NULL DEFAULT 0,
  sessions       INTEGER NOT NULL DEFAULT 0,
  sessions_sketch BLOB,
  clicks         INTEGER NOT NULL DEFAULT 0,
  time_total_sec INTEGER NOT NULL DEFAULT 0,
  time_samples   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (site_id, date, path)
);

-- Retention sweeps and baseline reads both scan by date.
CREATE INDEX IF NOT EXISTS idx_day_date  ON day_counters(date);
CREATE INDEX IF NOT EXISTS idx_page_date ON page_counters(date);
`;

interface DayRow {
  site_id: string;
  date: string;
  visitors: number;
  visitors_sketch: Uint8Array | null;
  conversions: number;
  conversion_time_total_sec: number;
  conversion_samples: number;
}

interface PageRow {
  site_id: string;
  date: string;
  path: string;
  views: number;
  sessions: number;
  sessions_sketch: Uint8Array | null;
  clicks: number;
  time_total_sec: number;
  time_samples: number;
}

export class SqliteCounterStore implements CounterStore {
  private db: DatabaseSync;

  /**
   * @param filename Path to the database file, or ":memory:" for tests.
   */
  constructor(filename: string) {
    this.db = new DatabaseSync(filename);
    // WAL lets the nightly rollup read while the ingest endpoint writes.
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA synchronous = NORMAL");
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  // ---------------------------------------------------------------- writes

  async record(
    siteId: string,
    date: string,
    visitor: string,
    events: RawEvent[],
  ): Promise<void> {
    if (events.length === 0) return;

    // A sketch can only be updated by reading it, folding the visitor in, and
    // writing it back — there is no SQL operator for "union this register set".
    // IMMEDIATE takes the write lock up front so two concurrent writers cannot
    // interleave a read-modify-write and lose one visitor's contribution.
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const state = this.loadState(siteId, date);
      const touched = new Set<string>();

      for (const event of events) {
        applyEvent(state, event, visitor);
        touched.add(event.path);
      }

      this.writeDay(state);
      for (const path of touched) {
        this.writePage(state, path);
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  private writeDay(state: DayState): void {
    this.db
      .prepare(
        `INSERT INTO day_counters
           (site_id, date, visitors, visitors_sketch,
            conversions, conversion_time_total_sec, conversion_samples)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(site_id, date) DO UPDATE SET
           visitors                  = excluded.visitors,
           visitors_sketch           = excluded.visitors_sketch,
           conversions               = excluded.conversions,
           conversion_time_total_sec = excluded.conversion_time_total_sec,
           conversion_samples        = excluded.conversion_samples`,
      )
      .run(
        state.siteId,
        state.date,
        // The count is materialised on every write so reads never touch a sketch.
        sketchCount(state.visitors),
        state.visitors,
        state.conversions,
        state.conversionTimeTotalSec,
        state.conversionSamples,
      );
  }

  private writePage(state: DayState, path: string): void {
    const p = state.pages[path];
    if (!p) return;
    this.db
      .prepare(
        `INSERT INTO page_counters
           (site_id, date, path, views, sessions, sessions_sketch,
            clicks, time_total_sec, time_samples)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(site_id, date, path) DO UPDATE SET
           views           = excluded.views,
           sessions        = excluded.sessions,
           sessions_sketch = excluded.sessions_sketch,
           clicks          = excluded.clicks,
           time_total_sec  = excluded.time_total_sec,
           time_samples    = excluded.time_samples`,
      )
      .run(
        state.siteId,
        state.date,
        path,
        p.views,
        sketchCount(p.sessions),
        p.sessions,
        p.clicks,
        p.timeOnPageTotalSec,
        p.timeSamples,
      );
  }

  // ----------------------------------------------------------------- reads

  private loadState(siteId: string, date: string): DayState {
    const state = newDayState(siteId, date);

    const row = this.db
      .prepare("SELECT * FROM day_counters WHERE site_id = ? AND date = ?")
      .get(siteId, date) as DayRow | undefined;

    if (row) {
      state.visitors = row.visitors_sketch
        ? Uint8Array.from(row.visitors_sketch)
        : emptySketch();
      state.conversions = row.conversions;
      state.conversionTimeTotalSec = row.conversion_time_total_sec;
      state.conversionSamples = row.conversion_samples;
    }

    const pages = this.db
      .prepare("SELECT * FROM page_counters WHERE site_id = ? AND date = ?")
      .all(siteId, date) as unknown as PageRow[];

    for (const p of pages) {
      const ps = newPageState();
      ps.views = p.views;
      ps.sessions = p.sessions_sketch ? Uint8Array.from(p.sessions_sketch) : emptySketch();
      ps.clicks = p.clicks;
      ps.timeOnPageTotalSec = p.time_total_sec;
      ps.timeSamples = p.time_samples;
      state.pages[p.path] = ps;
    }

    return state;
  }

  async get(siteId: string, date: string): Promise<DayCounters | undefined> {
    const row = this.db
      .prepare("SELECT * FROM day_counters WHERE site_id = ? AND date = ?")
      .get(siteId, date) as DayRow | undefined;
    if (!row) return undefined;
    return this.toCounters(row);
  }

  async baseline(siteId: string, date: string, days: number): Promise<DayCounters[]> {
    const from = shiftDate(date, -days);
    const to = shiftDate(date, -1);

    const rows = this.db
      .prepare(
        `SELECT * FROM day_counters
          WHERE site_id = ? AND date >= ? AND date <= ?
          ORDER BY date ASC`,
      )
      .all(siteId, from, to) as unknown as DayRow[];

    return rows.map((r) => this.toCounters(r));
  }

  private toCounters(row: DayRow): DayCounters {
    const pages: Record<string, PageCounters> = {};

    const pageRows = this.db
      .prepare("SELECT * FROM page_counters WHERE site_id = ? AND date = ?")
      .all(row.site_id, row.date) as unknown as PageRow[];

    for (const p of pageRows) {
      pages[p.path] = {
        views: p.views,
        sessions: p.sessions,
        clicks: p.clicks,
        timeOnPageTotalSec: p.time_total_sec,
        timeSamples: p.time_samples,
      };
    }

    return {
      siteId: row.site_id,
      date: row.date,
      visitors: row.visitors,
      pages,
      conversions: row.conversions,
      conversionTimeTotalSec: row.conversion_time_total_sec,
      conversionSamples: row.conversion_samples,
    };
  }

  // ----------------------------------------------------------- housekeeping

  async prune(today: string): Promise<PruneResult> {
    const cutoff = shiftDate(today, -RETENTION_DAYS);

    this.db.exec("BEGIN IMMEDIATE");
    try {
      // Close finished days: keep the counts, discard the sketches. Nothing can
      // be recounted afterwards, which is the correct trade and keeps history
      // to a few bytes per site-day.
      const cleared = this.db
        .prepare(
          "UPDATE day_counters SET visitors_sketch = NULL WHERE date < ? AND visitors_sketch IS NOT NULL",
        )
        .run(today);
      this.db
        .prepare(
          "UPDATE page_counters SET sessions_sketch = NULL WHERE date < ? AND sessions_sketch IS NOT NULL",
        )
        .run(today);

      // Enforce the 90-day promise.
      const dropped = this.db
        .prepare("DELETE FROM day_counters WHERE date < ?")
        .run(cutoff);
      this.db.prepare("DELETE FROM page_counters WHERE date < ?").run(cutoff);

      this.db.exec("COMMIT");

      return {
        daysDropped: Number(dropped.changes),
        sketchesCleared: Number(cleared.changes),
      };
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  /**
   * Test helper: the raw persisted sketch, or null once the day has closed.
   * Exists so a test can assert what actually reached disk rather than trusting
   * the read path not to hide it.
   */
  _visitorSketch(siteId: string, date: string): Uint8Array | null {
    const row = this.db
      .prepare("SELECT visitors_sketch FROM day_counters WHERE site_id = ? AND date = ?")
      .get(siteId, date) as { visitors_sketch: Uint8Array | null } | undefined;
    return row?.visitors_sketch ?? null;
  }

  /** Test helper: seed a finished day directly, bypassing event recording. */
  async _seedClosed(day: DayCounters): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO day_counters
           (site_id, date, visitors, visitors_sketch,
            conversions, conversion_time_total_sec, conversion_samples)
         VALUES (?, ?, ?, NULL, ?, ?, ?)
         ON CONFLICT(site_id, date) DO UPDATE SET visitors = excluded.visitors`,
      )
      .run(
        day.siteId,
        day.date,
        day.visitors,
        day.conversions,
        day.conversionTimeTotalSec,
        day.conversionSamples,
      );

    for (const [path, p] of Object.entries(day.pages)) {
      this.db
        .prepare(
          `INSERT INTO page_counters
             (site_id, date, path, views, sessions, sessions_sketch,
              clicks, time_total_sec, time_samples)
           VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)
           ON CONFLICT(site_id, date, path) DO UPDATE SET
             views = excluded.views, sessions = excluded.sessions`,
        )
        .run(
          day.siteId,
          day.date,
          path,
          p.views,
          p.sessions,
          p.clicks,
          p.timeOnPageTotalSec,
          p.timeSamples,
        );
    }
  }
}
