import type { Digest } from "../../../shared/types";

export function DigestCard({ digest }: { digest: Digest }) {
  return (
    <section style={{ border: "1px solid #e5e5e5", borderRadius: 12, padding: 20 }}>
      <h2 style={{ fontSize: 16, marginTop: 0 }}>{digest.headline}</h2>
      <p style={{ color: "#444" }}>{digest.narrative}</p>

      <div style={{ display: "flex", gap: 16, margin: "16px 0" }}>
        {digest.metrics.map((m) => (
          <div key={m.label}>
            <div style={{ fontSize: 24, fontWeight: 600 }}>{m.value}</div>
            <div style={{ fontSize: 13, color: "#666" }}>{m.label}</div>
            <div style={{ fontSize: 13, color: m.deltaPct >= 0 ? "#137333" : "#a50e0e" }}>
              {m.deltaPct >= 0 ? "+" : ""}
              {m.deltaPct}%
            </div>
          </div>
        ))}
      </div>

      {digest.leak && (
        <p style={{ background: "#fff4f4", padding: 12, borderRadius: 8, fontSize: 14 }}>
          <strong>Worth a look:</strong> {digest.leak.detail}
        </p>
      )}
      {digest.win && (
        <p style={{ background: "#f2fbf4", padding: 12, borderRadius: 8, fontSize: 14 }}>
          <strong>Bright spot:</strong> {digest.win.detail}
        </p>
      )}
    </section>
  );
}
