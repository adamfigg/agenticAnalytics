// The email template renders customer-facing HTML from data that ultimately
// traces back to page paths on a customer's site. Those are attacker-influenced
// in principle — a page called `/"><script>` is a path a site can genuinely
// have — so escaping is a correctness property, not a nicety.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { renderEmailHtml } from "./email_template";
import type { Digest } from "../../shared/types";

function digestWith(overrides: Partial<Digest> = {}): Digest {
  return {
    siteId: "demo-bakery",
    period: "2026-08-23",
    headline: "Drop-off spotted at /checkout",
    metrics: [
      { label: "Visitors", value: 412, deltaPct: 3.2 },
      { label: "Conversions", value: 38, deltaPct: -18.4 },
    ],
    leak: {
      page: "/checkout",
      detail: "62% of visitors leave at the shipping step",
      severity: "high",
    },
    win: { page: "/pricing", detail: "/pricing traffic is up 22% on its usual" },
    narrative: "Most visitors are dropping off at checkout.",
    shouldSend: true,
    emailBody: "plain text twin",
    ...overrides,
  };
}

describe("email template", () => {
  test("renders the narrative, headline and every metric", () => {
    const html = renderEmailHtml(digestWith());

    assert.match(html, /Drop-off spotted at \/checkout/);
    assert.match(html, /Most visitors are dropping off at checkout\./);
    assert.match(html, /412/);
    assert.match(html, /Conversions/);
    assert.match(html, /-18\.4%/);
  });

  test("escapes page paths so a hostile path cannot inject markup", () => {
    const html = renderEmailHtml(
      digestWith({
        headline: 'Drop-off at /"><script>alert(1)</script>',
        leak: {
          page: "/x",
          detail: '<img src=x onerror=alert(1)>',
          severity: "high",
        },
      }),
    );

    assert.ok(!html.includes("<script>alert(1)</script>"), "script tag must not survive");
    assert.ok(!html.includes("<img src=x"), "img tag must not survive");
    assert.match(html, /&lt;script&gt;/, "it should appear escaped instead");
  });

  test("omits the callouts entirely when there is no leak or win", () => {
    const html = renderEmailHtml(digestWith({ leak: null, win: null }));

    assert.ok(!html.includes("Worth a look:"), "no leak means no leak callout");
    assert.ok(!html.includes("Bright spot:"), "no win means no win callout");
    // The rest of the email must still be intact.
    assert.match(html, /Drop-off spotted at \/checkout/);
  });

  test("carries an unsubscribe affordance", () => {
    // A commercial send without one is not merely rude, it is unlawful in the
    // US and most other markets. This asserts the placeholder is present so it
    // cannot be quietly dropped before the real link is wired.
    assert.match(renderEmailHtml(digestWith()), /Unsubscribe/);
  });
});
