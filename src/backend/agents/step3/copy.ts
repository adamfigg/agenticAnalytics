// The single daily model call. Produces email narrative + sms line together so the
// two can't drift in tone, and so we spend one call/day not two. Small model on purpose.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hasAnthropicKey } from "../../lib/env";
import { runModel, parseJson } from "../../lib/model";
import type { Digest, CopyBundle } from "../../../shared/types";

// ESM has no __dirname (package.json sets "type": "module"), so derive it.
const HERE = dirname(fileURLToPath(import.meta.url));
const SYSTEM = readFileSync(join(HERE, "../../prompts/copy.md"), "utf8");

/**
 * Deterministic stand-in used only when ANTHROPIC_API_KEY is absent, so the
 * pipeline is runnable end-to-end with no account. It warns loudly rather than
 * failing silently — copy this bland is never what you want in front of a customer.
 */
function templateCopy(digest: Digest): CopyBundle {
  const moved = digest.metrics.find((m) => Math.abs(m.deltaPct) >= 15);
  const parts = [digest.headline + "."];
  if (digest.leak) parts.push(digest.leak.detail + ".");
  if (moved) {
    parts.push(
      `${moved.label} were ${moved.deltaPct > 0 ? "up" : "down"} ${Math.abs(moved.deltaPct)}%.`,
    );
  }
  if (digest.win) parts.push(digest.win.detail + ".");
  return {
    emailNarrative: parts.join(" "),
    smsLine: digest.leak ? digest.leak.detail : digest.headline,
  };
}

export interface CopyResult {
  copy: CopyBundle;
  source: "model" | "fallback";
  /** Why the model was not used, when it wasn't. */
  reason?: string;
}

export async function writeCopy(digest: Digest): Promise<CopyResult> {
  if (!hasAnthropicKey()) {
    return {
      copy: templateCopy(digest),
      source: "fallback",
      reason: "ANTHROPIC_API_KEY is not set",
    };
  }

  try {
    const res = await runModel({
      model: "claude-haiku-4-5", // a few friendly sentences; no need for a big model
      system: SYSTEM,
      input: JSON.stringify({
        headline: digest.headline,
        metrics: digest.metrics,
        leak: digest.leak,
        win: digest.win,
      }),
      maxTokens: 500,
    });
    return { copy: parseJson<CopyBundle>(res.text), source: "model" };
  } catch (err) {
    // A failed model call must not cost us the digest. Every finding above this
    // point was computed deterministically and is still correct; losing it to an
    // expired key or a rate limit would turn a copy problem into a data outage.
    // The nightly job should still deliver, and say the copy is the plain one.
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`[copy] model call failed, falling back to template: ${reason}`);
    return { copy: templateCopy(digest), source: "fallback", reason };
  }
}
