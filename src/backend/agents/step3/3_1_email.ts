// Agent 3.1 — email body. Wraps the shared copy call's email narrative in a template.
import type { Digest } from "../../../shared/types";
import type { CopyBundle } from "../../../shared/types";

export function buildEmail(digest: Digest, copy: CopyBundle): string {
  // Deterministic template around the model-written narrative. Keep HTML minimal;
  // swap for a React Email template when you wire Resend.
  const rows = digest.metrics
    .map((m) => `${m.label}: ${m.value} (${m.deltaPct >= 0 ? "+" : ""}${m.deltaPct}%)`)
    .join("\n");
  return [
    copy.emailNarrative,
    "",
    rows,
    "",
    digest.leak ? `Worth a look: ${digest.leak.detail}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
