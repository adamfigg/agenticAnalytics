// Email delivery via Resend.
//
// Raw REST rather than the `resend` package: the request is one POST, and this
// project has kept its dependency list to what it genuinely needs.
//
// The body is read straight off the digest object. No channel-specific copy is
// composed here — that would be the drift CLAUDE.md warns about, where the email
// and the Slack card slowly stop saying the same thing.
import type { Digest } from "../../shared/types";
import { renderEmailHtml } from "./email_template";
import type { DeliveryResult } from "./types";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/**
 * Resend's shared sender, usable with no domain verification but ONLY to the
 * address that owns the Resend account. Set RESEND_FROM to a verified domain
 * before sending to a real customer.
 */
const DEFAULT_FROM = "onboarding@resend.dev";

/** Cheap sanity check. Real validation is the provider's job, not a regex's. */
function looksLikeEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export async function sendEmail(digest: Digest, to: string): Promise<DeliveryResult> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) {
    return {
      ok: false,
      reason: "RESEND_API_KEY is not set in .env",
      configured: false,
    };
  }
  if (!digest.emailBody) {
    return {
      ok: false,
      reason: "this digest has no email body — the gate suppressed it",
      configured: true,
    };
  }
  if (!looksLikeEmail(to)) {
    return { ok: false, reason: `"${to}" is not an email address`, configured: true };
  }

  const from = process.env.RESEND_FROM?.trim() || DEFAULT_FROM;

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      // Both parts, always. `html` is what almost everyone sees; `text` is the
      // fallback for clients that refuse HTML, and its presence measurably
      // improves deliverability — a body-less-text email looks like spam.
      body: JSON.stringify({
        from,
        to: [to],
        subject: digest.headline,
        html: renderEmailHtml(digest),
        text: digest.emailBody,
      }),
    });

    const payload = (await res.json().catch(() => ({}))) as {
      id?: string;
      message?: string;
      name?: string;
    };

    if (!res.ok) {
      // Resend's most common rejection is sending from an unverified domain, or
      // to anyone other than the account owner while on the shared sender.
      return {
        ok: false,
        reason: payload.message ?? `Resend returned ${res.status}`,
        configured: true,
      };
    }

    return { ok: true, id: payload.id, detail: `sent from ${from}`, configured: true };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
      configured: true,
    };
  }
}
