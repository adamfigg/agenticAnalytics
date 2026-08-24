/*!
 * SmallBiz Analytics tracker. One script tag, no cookies, no config beyond the
 * site id:
 *
 *   <script async src="https://cdn.example.com/track.js" data-site="abc123"></script>
 *
 * It sets no cookie, reads no storage, and assigns no visitor ID — identity is
 * derived server-side from a salt that is destroyed at midnight. That is what
 * makes "no cookie banner required" true rather than merely claimed.
 *
 * Optional, for owners who want an exact conversion signal:
 *   window.sba && window.sba("convert");
 * Without it, conversions fall back to sessions on the last funnel step.
 */
(function () {
  var el = document.currentScript;
  var site = el && el.getAttribute("data-site");
  if (!site) return;

  var endpoint = (el.getAttribute("data-endpoint") || "") + "/api/ingest";
  var path = location.pathname;
  var enteredAt = Date.now();
  var engagementSent = false;

  function send(events) {
    var body = JSON.stringify({ site_id: site, events: events });
    // sendBeacon survives the unload that ends most sessions; keepalive fetch
    // is the fallback for browsers without it.
    if (navigator.sendBeacon) {
      navigator.sendBeacon(endpoint, new Blob([body], { type: "application/json" }));
    } else {
      fetch(endpoint, { method: "POST", body: body, keepalive: true, mode: "no-cors" });
    }
  }

  function secondsHere() {
    return Math.round((Date.now() - enteredAt) / 1000);
  }

  function view(nextPath) {
    path = nextPath;
    enteredAt = Date.now();
    engagementSent = false;
    send([{ type: "pageview", path: path }]);
  }

  function flushEngagement() {
    if (engagementSent) return;
    var secs = secondsHere();
    if (secs < 1) return;
    engagementSent = true;
    send([{ type: "engagement", path: path, seconds: secs }]);
  }

  // Initial pageview.
  send([{ type: "pageview", path: path }]);

  // Time on page, reported when the page is backgrounded or unloaded. Both
  // events are needed: mobile browsers often fire only visibilitychange.
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") flushEngagement();
  });
  window.addEventListener("pagehide", flushEngagement);

  // CTA clicks. Only elements the site owner explicitly marked are tracked, and
  // only the label they chose is sent — never element text or form values.
  document.addEventListener(
    "click",
    function (e) {
      var t = e.target && e.target.closest ? e.target.closest("[data-track]") : null;
      if (!t) return;
      send([{ type: "click", path: path, element: t.getAttribute("data-track") }]);
    },
    true,
  );

  // SPA route changes, so single-page sites report real funnels.
  ["pushState", "replaceState"].forEach(function (fn) {
    var orig = history[fn];
    history[fn] = function () {
      var r = orig.apply(this, arguments);
      if (location.pathname !== path) {
        flushEngagement();
        view(location.pathname);
      }
      return r;
    };
  });
  window.addEventListener("popstate", function () {
    if (location.pathname !== path) {
      flushEngagement();
      view(location.pathname);
    }
  });

  // Explicit conversion hook.
  window.sba = function (action) {
    if (action !== "convert") return;
    send([{ type: "convert", path: path, seconds: Math.round((Date.now() - enteredAt) / 1000) }]);
  };
})();
