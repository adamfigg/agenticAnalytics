# Analytics Lite

Lightweight web analytics for small businesses. It collects pageviews from a single
script tag (no cookies, no visitor IDs), works out where visitors go and where they
drop off, and — only when something moved — sends the owner a short, plain-English
digest by email and SMS. A Google Analytics CSV export can be imported instead, which
is how a migrating customer gets history on day one.

An AI agent writes the human-readable copy. Everything else is deterministic code.

## Layout

```
src/
  shared/types.ts          Type contracts shared by backend + frontend
  backend/
    ingest/                salt rotation, HLL sketches, SQLite store, HTTP handler
    lib/                   model wrapper, CSV parser, math helpers
    agents/
      step1/               1.1–1.5  analysis — PURE CODE, no model
      step2/               2.1      compose digest + suppression gate
      step3/               3.1/3.2  email + sms copy (one shared model call)
    prompts/               editable "goals" for the LLM agents (prose)
    fixtures/              committed sample data so the pipeline runs offline
    pipeline/run_daily.ts  orchestrator — chains agents in order
  frontend/                React dashboard that renders a Digest
public/track.js            the tracking snippet customers paste into their site
```

## The three rules that matter

1. **One model call per client per day.** Step 1 is arithmetic, not AI. Only step 3
   (the copywriting) uses a model, and email + SMS share a single call.
2. **Suppression gate.** `compose` sets `shouldSend`. If nothing moved, no model call,
   no send. A digest that only arrives when something changed gets read.
3. **No cookies, no visitor IDs.** A visitor is a hash of IP + user-agent + a salt that
   is destroyed at midnight, so yesterday's hashes can never be recomputed. Raw events
   are folded into counters and dropped inside the request. This is what lets us say
   "no cookie banner required" — see `src/backend/ingest/salt.ts`.

See `CLAUDE.md` for the full context and constraints.

## Getting started

```bash
npm install
cp .env.example .env      # fill in your keys
npm run dev               # frontend dashboard
npm run pipeline          # run the analysis pipeline once, against the CSV fixture
npm run demo              # simulate live traffic through ingest -> digest
npm run typecheck         # verify the type contracts hold
npm test                  # the suppression gate + the privacy guarantees
```

## Tests

`npm test` (Node's built-in runner, no extra dependency). Two things are covered,
because they are the two things that can quietly ruin the product:

- **The suppression gate.** Every test is named as a business scenario — a quiet
  Tuesday, a 12-visitor plumber, a funnel that always leaked, a funnel that broke
  this morning. A false positive here isn't cosmetic: it turns the digest into
  daily noise and the customer filters it to a folder.
- **The privacy guarantees.** That yesterday's visitor can't be re-identified once
  the salt rotates, and that no IP, user-agent or visitor hash reaches storage.
  These are public claims; a claim that lives only in a comment is one refactor
  away from being false.
- **Store conformance.** One suite runs against both the in-memory and SQLite
  stores, so the stand-in every other test uses cannot quietly drift from the real
  one, plus a durability check that counters survive a close and reopen.

The thresholds those tests pin down (15% move, 30-session minimum, 40% drop-off
floor, 15-point elevation) are first cuts. They are deliberately in one place each
so they can be tuned against real traffic — see CLAUDE.md's open question.

## Counting visitors without keeping visitors

Distinct-visitor counts come from a HyperLogLog sketch, not from a set of who was
seen. Each visitor hash nudges at most one register in a fixed 16KB array; the count
is reconstructed from the register distribution. There is no visitor list anywhere —
not on disk, not in cache, not for a second — so there is nothing to leak or be
compelled to hand over. When a day closes, `prune()` discards even the sketch and
keeps only the integer.

The trade is precision: counts are within about 1%, so a 240-visitor day may report
238. That is far smaller than the discrepancy any two analytics tools have with each
other, and it is asserted by a test rather than assumed.

Sketches also merge, which is what will make the weekly roll-up a true distinct count
rather than a sum of daily counts that double-counts everyone who returned.

## Not included (your side)

- **A server for the ingest endpoint.** `createIngestHandler` is a plain
  `Request -> Response` function, so it mounts on Hono, Next, Workers or Deno. Picking
  one is deliberately left open.
- Real delivery wiring (Resend + Twilio) — credentials, real sends
- The cron scheduler — timing (daily 8am vs weekly Monday) is TBD
- `.env` — only `.env.example` is committed
