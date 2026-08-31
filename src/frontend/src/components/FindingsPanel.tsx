// What the deterministic agents computed, shown before the digest so it is
// obvious the arithmetic happened in plain code and the model only ever saw the
// finished findings.
import type { Digest, Step1Bundle } from "../../../shared/types";

export function GateBanner({
  digest,
  usedModel,
  baseUrl,
}: {
  digest: Digest;
  usedModel: boolean;
  baseUrl?: string;
}) {
  const sent = digest.shouldSend;
  const proxied = baseUrl != null && !baseUrl.startsWith("https://api.anthropic.com");

  return (
    <>
      <div className={`gate ${sent ? "send" : "hold"}`}>
        <span className="mark">{sent ? "✓" : "⏸"}</span>
        <div>
          <strong>
            {sent ? "Gate open — this day sends" : "Suppressed — nothing worth sending"}
          </strong>
          <p>
            {sent
              ? usedModel
                ? "One model call was made to write the copy."
                : "The copy below came from the deterministic fallback, not the model."
              : "The model was never called, so this day cost nothing. The finding batches into the weekly roll-up."}
          </p>
        </div>
      </div>

      {sent && !usedModel && digest.copyReason && (
        <div className="gate hold" style={{ marginTop: -8 }}>
          <span className="mark">⚠</span>
          <div>
            <strong>The model call did not happen</strong>
            <p>
              {digest.copyReason}
              {proxied && (
                <>
                  {" "}
                  Requests are going to <code>{baseUrl}</code>, not Anthropic — an
                  ANTHROPIC_BASE_URL in your shell is redirecting them.
                </>
              )}
            </p>
          </div>
        </div>
      )}
    </>
  );
}

export function FindingsPanel({ step1 }: { step1: Step1Bundle }) {
  const { stats, funnel, trends, conversionCta } = step1;

  return (
    <div className="panel">
      <h2>What the agents computed</h2>

      <div className="stat-row">
        <Stat n={stats.totalVisitors} k="Visitors" />
        <Stat n={stats.totalConversions} k="Conversions" />
        <Stat n={`${stats.conversionRatePct}%`} k="Conversion rate" />
        <Stat
          n={`${stats.visitorsDeltaPct >= 0 ? "+" : ""}${stats.visitorsDeltaPct}%`}
          k="vs baseline"
        />
        <Stat n={trends.overallDirection} k="Direction" />
      </div>

      <h3>Funnel</h3>
      <table className="findings">
        <thead>
          <tr>
            <th>Step</th>
            <th>Entered</th>
            <th>Drop-off</th>
            <th>Normally</th>
            <th>Elevation</th>
          </tr>
        </thead>
        <tbody>
          {funnel.steps.map((s) => {
            const isWorst = s.page === funnel.biggestLeak?.page;
            return (
              <tr key={s.page}>
                <td className="mono">
                  {s.page}
                  {isWorst && s.elevationPct !== undefined && (
                    <span className="pill" style={{ marginLeft: 8 }}>
                      worst
                    </span>
                  )}
                </td>
                <td>{s.entered}</td>
                <td>{s.dropoffPct}%</td>
                <td className="muted">
                  {s.baselineDropoffPct === undefined ? "no history" : `${s.baselineDropoffPct}%`}
                </td>
                <td className={s.elevationPct === undefined ? "muted" : s.elevationPct > 0 ? "up" : "down"}>
                  {s.elevationPct === undefined
                    ? "—"
                    : `${s.elevationPct > 0 ? "+" : ""}${s.elevationPct} pts`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {conversionCta.bestCta && (
        <>
          <h3>CTAs</h3>
          <table className="findings">
            <tbody>
              <tr>
                <td className="muted">Best</td>
                <td className="mono">{conversionCta.bestCta.page}</td>
                <td>
                  {conversionCta.bestCta.clicks} clicks · {conversionCta.bestCta.ctr}% CTR
                </td>
              </tr>
              {conversionCta.worstCta && conversionCta.worstCta.page !== conversionCta.bestCta.page && (
                <tr>
                  <td className="muted">Worst</td>
                  <td className="mono">{conversionCta.worstCta.page}</td>
                  <td>
                    {conversionCta.worstCta.clicks} clicks · {conversionCta.worstCta.ctr}% CTR
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function Stat({ n, k }: { n: string | number; k: string }) {
  return (
    <div className="stat">
      <div className="n">{n}</div>
      <div className="k">{k}</div>
    </div>
  );
}
