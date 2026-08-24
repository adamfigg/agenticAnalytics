// The aggregate store contract, and an in-memory implementation of it.
//
// `MemoryCounterStore` is a faithful stand-in, not a simplification: it uses the
// same HLL sketches and the same day-closing rules as the SQLite store, so a
// test that passes against one passes against the other. What it does NOT do is
// survive a restart — see `sqlite_store.ts` for the real thing.
import {
  DayCounters,
  DayState,
  RawEvent,
  applyEvent,
  materialize,
  newDayState,
} from "./counters";

/** Retention is a public promise, so it lives in the store, not in a cron job. */
export const RETENTION_DAYS = 90;

export interface PruneResult {
  /** Site-days deleted for being past the retention window. */
  daysDropped: number;
  /** Closed days whose sketches were discarded, leaving only counts. */
  sketchesCleared: number;
}

export interface CounterStore {
  /**
   * Fold one visitor's events into a day. The store owns distinct-visitor
   * counting, so callers never track who they have already seen.
   */
  record(siteId: string, date: string, visitor: string, events: RawEvent[]): Promise<void>;
  get(siteId: string, date: string): Promise<DayCounters | undefined>;
  /** The N days ending the day BEFORE `date`, oldest first. Gaps are omitted. */
  baseline(siteId: string, date: string, days: number): Promise<DayCounters[]>;
  /**
   * Nightly housekeeping: drop days past retention, and discard the sketches of
   * days that have closed. A closed day keeps its counts and loses its ability
   * to be recounted — which is the correct trade, and shrinks history to almost
   * nothing.
   */
  prune(today: string): Promise<PruneResult>;
}

export function shiftDate(date: string, deltaDays: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

export class MemoryCounterStore implements CounterStore {
  /** Days still open for writing, holding sketches. */
  private open = new Map<string, DayState>();
  /** Days that have closed: counts only, sketches discarded. */
  private closed = new Map<string, DayCounters>();

  private key(siteId: string, date: string): string {
    return `${siteId}:${date}`;
  }

  async record(
    siteId: string,
    date: string,
    visitor: string,
    events: RawEvent[],
  ): Promise<void> {
    const key = this.key(siteId, date);
    let state = this.open.get(key);
    if (!state) {
      state = newDayState(siteId, date);
      this.open.set(key, state);
    }
    for (const event of events) {
      applyEvent(state, event, visitor);
    }
  }

  async get(siteId: string, date: string): Promise<DayCounters | undefined> {
    const key = this.key(siteId, date);
    const closed = this.closed.get(key);
    if (closed) return closed;
    const open = this.open.get(key);
    return open ? materialize(open) : undefined;
  }

  async baseline(siteId: string, date: string, days: number): Promise<DayCounters[]> {
    const out: DayCounters[] = [];
    for (let i = days; i >= 1; i--) {
      const day = await this.get(siteId, shiftDate(date, -i));
      if (day) out.push(day);
    }
    return out;
  }

  async prune(today: string): Promise<PruneResult> {
    const cutoff = shiftDate(today, -RETENTION_DAYS);
    let daysDropped = 0;
    let sketchesCleared = 0;

    for (const [key, state] of this.open) {
      if (state.date < today) {
        this.closed.set(key, materialize(state));
        this.open.delete(key);
        sketchesCleared += 1;
      }
    }

    for (const map of [this.closed, this.open]) {
      for (const [key, day] of map) {
        if (day.date < cutoff) {
          map.delete(key);
          daysDropped += 1;
        }
      }
    }

    return { daysDropped, sketchesCleared };
  }

  /** Test helper: seed a finished day directly, bypassing event recording. */
  async _seedClosed(day: DayCounters): Promise<void> {
    this.closed.set(this.key(day.siteId, day.date), day);
  }

  _reset(): void {
    this.open.clear();
    this.closed.clear();
  }
}
