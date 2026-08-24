# Analytics Lite

Lightweight web analytics for small businesses. It reads a Google Analytics CSV export,
works out where visitors go and where they drop off, and — only when something moved —
sends the owner a short, plain-English digest by email and SMS.

An AI agent writes the human-readable copy. Everything else is deterministic code.

## Layout

```
src/
  shared/types.ts          Type contracts shared by backend + frontend
  backend/
    lib/                   model wrapper, CSV parser, math helpers
    agents/
      step1/               1.1–1.5  analysis — PURE CODE, no model
      step2/               2.1      compose digest + suppression gate
      step3/               3.1/3.2  email + sms copy (one shared model call)
    prompts/               editable "goals" for the LLM agents (prose)
    pipeline/run_daily.ts  orchestrator — chains agents in order
  frontend/                React dashboard that renders a Digest
```

## The two rules that matter

1. **One model call per client per day.** Step 1 is arithmetic, not AI. Only step 3
   (the copywriting) uses a model, and email + SMS share a single call.
2. **Suppression gate.** `compose` sets `shouldSend`. If nothing moved, no model call,
   no send. A digest that only arrives when something changed gets read.

See `CLAUDE.md` for the full context and constraints.

## Getting started

```bash
npm install
cp .env.example .env      # fill in your keys
npm run dev               # frontend dashboard
npm run pipeline          # run the analysis pipeline once
npm run typecheck         # verify the type contracts hold
```

## Not included (your side)

- Real delivery wiring (Resend + Twilio) — credentials, real sends
- The cron scheduler — timing (daily 8am vs weekly Monday) is TBD
- `.env` — only `.env.example` is committed
