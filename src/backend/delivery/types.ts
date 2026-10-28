// Shared shape for every delivery channel. A channel reports what happened
// honestly — including "I am not configured" as a distinct case from "I tried
// and failed", because those need very different responses from the operator.
export interface DeliveryResult {
  ok: boolean;
  /** Provider-side id, when the send succeeded. */
  id?: string;
  /** Why it failed. Operator-facing; never shown to a customer. */
  reason?: string;
  /** Extra context on success, e.g. which sender address was used. */
  detail?: string;
  /** False when credentials are missing — a setup problem, not a send failure. */
  configured: boolean;
}
