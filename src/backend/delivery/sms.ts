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
      // 21608 is the one you will actually hit on a trial account: the
      // destination number has not been verified in the Twilio console.
      const hint =
        payload.code === 21608
          ? " (trial accounts can only text numbers verified in the Twilio console)"
          : "";
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
