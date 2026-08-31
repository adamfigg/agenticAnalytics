// The HTML email, rendered from the digest object.
//
// Hand-written HTML rather than React Email: this is one small template, and a
// JSX-to-HTML render pipeline is a real dependency to carry for it. If the
// template grows past a couple of screens, swap it — the seam is this one
// function, and nothing else knows how the email is built.
//
// Email HTML is not web HTML. Styles must be inline (Gmail strips <style>), the
// layout is a table (Outlook ignores flex and grid), and everything needs a
// plain-text twin for clients that refuse HTML entirely.
import type { Digest } from "../../shared/types";

const INK = "#16181d";
const SOFT = "#5b6270";
const LINE = "#e3e6ec";
const GOOD = "#137333";
const BAD = "#a50e0e";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function metricCell(label: string, value: number, deltaPct: number): string {
  // A rise in visitors is good; a rise in nothing else is assumed here. The
  // colour is deliberately only applied to the delta, not the number, so a red
  // figure never reads as "this metric is bad".
  const up = deltaPct >= 0;
  const colour = up ? GOOD : BAD;
  const sign = up ? "+" : "";
  return `
    <td style="padding:0 24px 0 0;vertical-align:top;">
      <div style="font-size:26px;font-weight:600;color:${INK};line-height:1.2;">${value}</div>
      <div style="font-size:13px;color:${SOFT};padding-top:2px;">${escapeHtml(label)}</div>
      <div style="font-size:13px;color:${colour};padding-top:1px;">${sign}${deltaPct}%</div>
    </td>`;
}

function callout(title: string, body: string, accent: string, bg: string): string {
  return `
    <tr><td style="padding-top:16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
             style="background:${bg};border-left:3px solid ${accent};border-radius:6px;">
        <tr><td style="padding:12px 14px;font-size:14px;color:${INK};line-height:1.5;">
          <strong style="color:${accent};">${escapeHtml(title)}</strong> ${escapeHtml(body)}
        </td></tr>
      </table>
    </td></tr>`;
}

/**
 * Render the digest as an HTML email.
 *
 * `narrative` is the model-written copy; everything else is the deterministic
 * findings. The template adds no claims of its own — if a fact is not in the
 * digest, it does not appear here.
 */
export function renderEmailHtml(digest: Digest): string {
  const metrics = digest.metrics
    .map((m) => metricCell(m.label, m.value, m.deltaPct))
    .join("");

  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f7f8fa;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
         style="background:#f7f8fa;padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
             style="max-width:560px;background:#ffffff;border:1px solid ${LINE};border-radius:12px;
                    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
        <tr><td style="padding:24px 24px 0;">
          <div style="font-size:12px;letter-spacing:0.06em;text-transform:uppercase;color:${SOFT};">
            ${escapeHtml(digest.period)}
          </div>
          <h1 style="margin:6px 0 0;font-size:20px;line-height:1.3;color:${INK};font-weight:600;">
            ${escapeHtml(digest.headline)}
          </h1>
        </td></tr>

        <tr><td style="padding:14px 24px 0;font-size:15px;line-height:1.6;color:${INK};">
          ${escapeHtml(digest.narrative)}
        </td></tr>

        <tr><td style="padding:20px 24px 0;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${metrics}</tr></table>
        </td></tr>

        <tr><td style="padding:0 24px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            ${digest.leak ? callout("Worth a look:", digest.leak.detail, BAD, "#fff4f4") : ""}
            ${digest.win ? callout("Bright spot:", digest.win.detail, GOOD, "#f2fbf4") : ""}
          </table>
        </td></tr>

        <tr><td style="padding:22px 24px 24px;">
          <div style="border-top:1px solid ${LINE};padding-top:14px;font-size:12px;color:${SOFT};line-height:1.5;">
            You are getting this because something moved on ${escapeHtml(digest.siteId)}.
            Quiet days do not send.
            <!-- CAN-SPAM: a commercial send needs a working unsubscribe link and a
                 postal address here before this goes to a real customer. -->
            <br />Unsubscribe · SmallBiz Analytics
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
