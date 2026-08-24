import { useState } from "react";
import type { Digest } from "../../shared/types";
import { DigestCard } from "./components/DigestCard";

// Placeholder sample so the dashboard renders before the API is wired.
// Replace with a fetch to your backend endpoint that returns a Digest.
const sample: Digest = {
  siteId: "demo",
  period: "2026-07-08",
  headline: "Drop-off spotted at /checkout",
  metrics: [
    { label: "Visitors", value: 412, deltaPct: 3.2 },
    { label: "Conversions", value: 38, deltaPct: -18.4 },
  ],
  leak: { page: "/checkout", detail: "62% of visitors leave at the shipping step", severity: "high" },
  win: { page: "/pricing", detail: "Pricing page drew the most traffic" },
  narrative: "Most of your visitors are dropping off at the checkout shipping step. Pricing traffic is up.",
  shouldSend: true,
};

export default function App() {
  const [digest] = useState<Digest>(sample);
  return (
    <main style={{ maxWidth: 640, margin: "40px auto", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 20 }}>Your site, yesterday</h1>
      <DigestCard digest={digest} />
    </main>
  );
}
