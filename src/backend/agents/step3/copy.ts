// The single daily model call. Produces email narrative + sms line together so the
// two can't drift in tone, and so we spend one call/day not two. Small model on purpose.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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

export async function writeCopy(digest: Digest): Promise<CopyBundle> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("[copy] ANTHROPIC_API_KEY not set — using template copy, not the model.");
    return templateCopy(digest);
  }

  const res = await runModel({
    model: "claude-haiku-4-5", // writing a few friendly sentences; no need for a big model
    system: SYSTEM,
    input: JSON.stringify({
      headline: digest.headline,
      metrics: digest.metrics,
      leak: digest.leak,
      win: digest.win,
    }),
    maxTokens: 500,
  });
  return parseJson<CopyBundle>(res.text);
}
