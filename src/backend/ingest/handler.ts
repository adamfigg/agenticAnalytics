// The ingest endpoint, written against the Web-standard Request/Response pair
// so it mounts unchanged on Hono, Next route handlers, Cloudflare Workers, Deno
// or Node 18+. No server framework is pulled in — picking one is your call, and
// this file does not care which you pick.
//
// The flow is: derive today's visitor hash -> fold each event into counters ->
// drop the raw event. Nothing identifying survives past the end of this function.
import { RawEvent } from "./counters";
import { CounterStore } from "./store";
import { visitorHash } from "./salt";

/** Reject absurd payloads outright; a real beacon sends one or two events. */
const MAX_EVENTS_PER_REQUEST = 20;

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("cf-connecting-ip") ?? "0.0.0.0";
}

function isRawEvent(v: unknown): v is RawEvent {
  if (typeof v !== "object" || v === null) return false;
  const e = v as Record<string, unknown>;
  if (typeof e.path !== "string" || e.path.length === 0 || e.path.length > 512) return false;
  switch (e.type) {
    case "pageview":
      return true;
    case "click":
      return typeof e.element === "string" && e.element.length <= 128;
    case "engagement":
    case "convert":
      return typeof e.seconds === "number" && Number.isFinite(e.seconds);
    default:
      return false;
  }
}

export interface IngestDeps {
  store: CounterStore;
  /** Injected so tests and client-local-midnight handling stay deterministic. */
  today: (siteId: string) => string;
}

export function createIngestHandler(deps: IngestDeps) {
  return async function handleIngest(req: Request): Promise<Response> {
    if (req.method !== "POST") {
      return new Response(null, { status: 405 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "invalid json" }, { status: 400 });
    }

    const parsed = body as { site_id?: unknown; events?: unknown };
    const siteId = typeof parsed.site_id === "string" ? parsed.site_id : "";
    if (!siteId || !Array.isArray(parsed.events)) {
      return Response.json({ error: "site_id and events required" }, { status: 400 });
    }

    const events = parsed.events.slice(0, MAX_EVENTS_PER_REQUEST).filter(isRawEvent);

    const date = deps.today(siteId);
    // Derived, used and discarded inside this request. Never stored, never
    // logged. The store folds it into a sketch, so no set of visitors exists
    // anywhere to be counted a second time — or leaked.
    const visitor = visitorHash(clientIp(req), req.headers.get("user-agent") ?? "", date);

    await deps.store.record(siteId, date, visitor, events);
    // `events` and `visitor` go out of scope here. That is "discard raw".

    // 204: the snippet fires and forgets, and we return nothing to the visitor.
    return new Response(null, { status: 204 });
  };
}
