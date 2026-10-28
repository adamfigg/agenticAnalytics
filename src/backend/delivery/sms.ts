// SMS delivery via Twilio.
//
// Raw REST rather than the `twilio` package — the SDK is large and this is one
// form-encoded POST with basic auth.
//
// Worth knowing before this works in production: US carriers require A2P 10DLC
// registration for application-to-person messaging. Until a campaign is
// approved, a Twilio trial account can only send to numbers you have verified
// in the console, and every message is prefixed with a trial notice. See
// CLAUDE.md -> Delivery.
import type { Digest } from "../../shared/types";
import type { DeliveryResult } from "./types";

/** One segment. Past this a message is billed as two and may be split oddly. */
const SMS_SEGMENT_LIMIT = 160;

export async function sendSms(digest: Digest, to: string): Promise<DeliveryResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  const from = process.env.TWILIO_FROM_NUMBER?.trim();

  const missing = [
    !sid && "TWILIO_ACCOUNT_SID",
    !token && "TWILIO_AUTH_TOKEN",
    !from && "TWILIO_FROM_NUMBER",
  ].filter(Boolean);

  if (missing.length > 0) {
    return {
      ok: false,
      reason: `not set in .env: ${missing.join(", ")}`,
      configured: false,
    };
  }
  if (!digest.smsBody) {
    return {
      ok: false,
      reason: "this digest has no SMS body — the gate suppressed it",
      configured: true,
    };
  }

  const body = digest.smsBody.slice(0, SMS_SEGMENT_LIMIT);

  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: to, From: from!, Body: body }),
      },
    );

    const payload = (await res.json().catch(() => ({}))) as {
      sid?: string;
      message?: string;
      code?: number;
    };

    if (!res.ok) {
      // The two failures worth naming, because neither is a bug in this code and
      // both read as mysterious otherwise.
      const hints: Record<number, string> = {
        // Trial accounts refuse any destination not verified in the console.
        21608: " (trial account: verify this number in the Twilio console first)",
        // Paid US long codes still need an approved A2P 10DLC campaign. Carriers
        // block unregistered application-to-person traffic outright.
        30034:
          " (this number is not registered for A2P 10DLC — US carriers block" +
          " unregistered application-to-person SMS, regardless of account balance)",
        // Landline or unreachable carrier.
        21614: " (the destination cannot receive SMS)",
      };
      const hint = hints[payload.code ?? -1] ?? "";
      return {
        ok: false,
        reason: `${payload.message ?? `Twilio returned ${res.status}`}${hint}`,
        configured: true,
      };
    }

    return {
      ok: true,
      id: payload.sid,
      detail: `sent from ${from} (${body.length} chars)`,
      configured: true,
    };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
      configured: true,
    };
  }
}
