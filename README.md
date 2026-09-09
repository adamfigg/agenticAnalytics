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
npm run dev               # the digest test bench, at localhost:5173
npm run pipeline          # run the analysis pipeline once, against the CSV fixture
npm run demo              # simulate live traffic through ingest -> digest
npm run typecheck         # verify the type contracts hold
npm test                  # the suppression gate + the privacy guarantees
```

## The test bench

`npm run dev` opens a bench for exercising the pipeline against days you make up,
rather than waiting for real traffic to produce an interesting one. Set every
metric by hand, press **Run the agents**, and read the email and the text message
exactly as they would arrive.

It runs the real pipeline — the same step 1 agents, the same gate, the same single
model call — through a Vite dev-server plugin (`src/backend/server/bench_api.ts`,
`apply: "serve"`, so it can never reach a production build). Scenarios are built
with the same `makeSiteData` the test suite uses, so a scenario that behaves one
way in the bench behaves that way in a test.

Five presets cover the branches worth knowing:

| Preset | What it proves |
|---|---|
| Checkout broke today | A leak far above its own norm sends, even with traffic flat |
| Quiet Tuesday | A permanently leaky funnel stays quiet — nothing changed |
| Tiny site, meaningless spike | +100% on 12 sessions is noise; the low-traffic guard holds |
| Traffic surge | A real move on real traffic sends |
| Orders collapsed | Orders halving sends even with traffic and the funnel steady |
| New site, no history | Drop-off is reported but can never trigger a send on its own |

Without `ANTHROPIC_API_KEY` the copy comes from the deterministic fallback, and the
bench says so in the header rather than pretending a model wrote it.

## Turning the model on

The pipeline is fully runnable with no account, which is why the fallback exists. To
have the agent actually write the copy:

1. Create a key at <https://console.anthropic.com/> (Settings -> API keys).
2. Put it in `.env` at the repo root:

   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ```

3. Restart `npm run dev`. `.env` is read at startup, not per request.

The badge in the bench header flips to "runs hit the real model", and the gate banner
stops saying the copy came from the fallback. `.env` is gitignored; never commit a key.

Cost is one Haiku call per client per day, only on days the gate opens — fractions of
a cent per site per month. That ceiling is a hard constraint, not a target: see
CLAUDE.md -> "Cost discipline".

## Delivery

The bench has **Send email** and **Send text** buttons under each message preview.
Both send exactly the bytes shown above them — the preview is not a re-render.
Neither has a default recipient, and both refuse a suppressed digest, so nothing
goes out as a side effect of running a scenario.

### Email (live)

1. Create a free account at <https://resend.com> and an API key under **API Keys**.
2. Put it in `.env`: `RESEND_API_KEY=re_...`
3. Restart `npm run dev`, run a scenario, type a recipient, press **Send email**.

The free tier is 3,000 emails a month, 100 a day. Until you set `RESEND_FROM` to an
address on a domain you have verified with Resend, sends use the shared
`onboarding@resend.dev` sender — which Resend only permits to mail the address that
owns the account. That is enough to test with; it is not enough to mail a customer.

The email goes out as HTML with a plain-text twin. `renderEmailHtml`
(`src/backend/delivery/email_template.ts`) builds it from the digest and nothing
else — inline styles and a table layout, because Gmail strips `<style>` and Outlook
ignores flex. The bench previews the exact bytes Resend is handed, in a sandboxed
iframe, so what you approve is what ships.

**Before mailing a real customer:** the footer carries an unsubscribe placeholder, not
a working link. A commercial send needs a real one plus a postal address to satisfy
CAN-SPAM. A test asserts the placeholder is present so it cannot be quietly dropped.

### SMS (on hold)

The copy is still generated on every run and the delivery module works, but the send
button is parked. Turning it on needs Twilio credentials and, for US numbers, **A2P
10DLC registration** — a one-off brand fee, a monthly campaign fee, and an approval
wait measured in days to weeks. Start that early when you pick it back up; the
registration is the long pole, not the money.

Sending is manual on purpose. Automatic delivery belongs in the nightly job, behind
the suppression gate — not in a tool whose whole purpose is experimenting with
numbers.

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
