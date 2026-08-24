// The single daily model call. Produces email narrative + sms line together so the
// two can't drift in tone, and so we spend one call/day not two. Small model on purpose.
import { readFileSync } from "fs";
import { join } from "path";
import { runModel, parseJson } from "../../lib/model";
import type { Digest, CopyBundle } from "../../../shared/types";

const SYSTEM = readFileSync(join(__dirname, "../../prompts/copy.md"), "utf8");

export async function writeCopy(digest: Digest): Promise<CopyBundle> {
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
