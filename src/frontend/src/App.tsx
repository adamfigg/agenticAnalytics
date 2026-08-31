// The test bench. Set every metric by hand, run the real pipeline, and read the
// email and text message that would go out.
//
// This is a development tool, not the customer dashboard. It exists so the gate
// and the copy can be exercised against made-up days without waiting for real
// traffic — see `src/backend/server/bench_api.ts` for the endpoint behind it.
import { useEffect, useState } from "react";

import { SCENARIOS, type BenchForm } from "./bench/scenarios";
import { fetchEnv, runBench, type BenchEnv, type BenchResult } from "./bench/api";
import { ScenarioForm } from "./components/ScenarioForm";
import { FindingsPanel, GateBanner } from "./components/FindingsPanel";
import { MessagePreview } from "./components/MessagePreview";
import { DigestCard } from "./components/DigestCard";
import "./bench/bench.css";

export default function App() {
  const [form, setForm] = useState<BenchForm>(SCENARIOS[0]!.form);
  const [activePreset, setActivePreset] = useState<string | null>(SCENARIOS[0]!.name);
  const [result, setResult] = useState<BenchResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [env, setEnv] = useState<BenchEnv>({
    hasApiKey: false,
    baseUrl: "",
    emailConfigured: false,
    smsConfigured: false,
  });

  useEffect(() => {
    void fetchEnv().then(setEnv);
  }, []);

  function applyPreset(name: string): void {
    const preset = SCENARIOS.find((s) => s.name === name);
    if (!preset) return;
    setForm(preset.form);
    setActivePreset(name);
    setResult(null);
    setError(null);
  }

  function editForm(next: BenchForm): void {
    setForm(next);
    // Once a number is touched by hand this is no longer that preset, and the
    // preset's stated expectation no longer applies.
    setActivePreset(null);
  }

  async function run(): Promise<void> {
    setRunning(true);
    setError(null);
    try {
      setResult(await runBench(form));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setResult(null);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="wrap">
      <header className="bench-head">
        <h1>Digest test bench</h1>
        <span className={`badge ${env.hasApiKey ? "live" : ""}`}>
          {env.hasApiKey
            ? "ANTHROPIC_API_KEY set — runs hit the real model"
            : "No API key — copy comes from the template fallback"}
        </span>
      </header>
      <p className="subtitle">
        Set the numbers by hand, run the real pipeline, and read what would actually be sent.
      </p>

      <div className="cols">
        <ScenarioForm
          form={form}
          activePreset={activePreset}
          running={running}
          onChange={editForm}
          onPreset={applyPreset}
          onRun={() => void run()}
        />

        <div>
          {error && <div className="error">{error}</div>}

          {!result && !error && (
            <div className="panel">
              <div className="empty">
                Nothing run yet. Adjust the numbers on the left and press <strong>Run the
                agents</strong>.
              </div>
            </div>
          )}

          {result && (
            <>
              <GateBanner
                digest={result.digest}
                usedModel={result.usedModel}
                baseUrl={result.baseUrl}
              />
              <FindingsPanel step1={result.step1} />

              <div className="panel">
                <h2>Digest object · {result.elapsedMs} ms</h2>
                <DigestCard digest={result.digest} />
              </div>

              <details className="raw">
                <summary>Raw digest JSON</summary>
                <pre>{JSON.stringify(result.digest, null, 2)}</pre>
              </details>
            </>
          )}
        </div>
      </div>

      {result && <MessagePreview digest={result.digest} env={env} emailHtml={result.emailHtml} />}
    </div>
  );
}
