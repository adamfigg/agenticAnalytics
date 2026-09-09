// The manual-entry side of the bench. Every number that can change the outcome
// is editable here — there is no hidden state feeding the pipeline.
import type { BenchForm, StepRow } from "../bench/scenarios";
import { SCENARIOS } from "../bench/scenarios";

interface Props {
  form: BenchForm;
  activePreset: string | null;
  running: boolean;
  onChange: (next: BenchForm) => void;
  onPreset: (name: string) => void;
  onRun: () => void;
}

export function ScenarioForm({ form, activePreset, running, onChange, onPreset, onRun }: Props) {
  const set = <K extends keyof BenchForm>(key: K, value: BenchForm[K]) =>
    onChange({ ...form, [key]: value });

  const setStep = (index: number, patch: Partial<StepRow>) =>
    onChange({
      ...form,
      steps: form.steps.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    });

  const addStep = () =>
    onChange({ ...form, steps: [...form.steps, { path: "", today: 0, typical: 0, clicks: 0 }] });

  const removeStep = (index: number) =>
    onChange({ ...form, steps: form.steps.filter((_, i) => i !== index) });

  const expectation = SCENARIOS.find((s) => s.name === activePreset)?.expectation;

  return (
    <div>
      <div className="panel">
        <h2>Preset scenarios</h2>
        <div className="presets">
          {SCENARIOS.map((s) => (
            <button
              key={s.name}
              type="button"
              className="preset"
              aria-pressed={activePreset === s.name}
              onClick={() => onPreset(s.name)}
            >
              {s.name}
            </button>
          ))}
        </div>
        <p className="expectation">
          {expectation ?? "Pick a preset to load a scenario, or edit any number below by hand."}
        </p>
      </div>

      <div className="panel">
        <h2>The day being reported on</h2>

        <div className="field-row">
          <div>
            <label htmlFor="siteId">Site id</label>
            <input
              id="siteId"
              type="text"
              value={form.siteId}
              onChange={(e) => set("siteId", e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="period">Period</label>
            <input
              id="period"
              type="text"
              value={form.period}
              onChange={(e) => set("period", e.target.value)}
            />
          </div>
        </div>

        <div className="field-row">
          <div>
            <label htmlFor="visitors">Distinct visitors today</label>
            <input
              id="visitors"
              type="number"
              min={0}
              value={form.visitors}
              onChange={(e) => set("visitors", Number(e.target.value))}
            />
          </div>
          <div>
            <label htmlFor="convTime">
              Avg. conversion time (sec) <span className="inert">not used yet</span>
            </label>
            <input
              id="convTime"
              type="number"
              min={0}
              value={form.avgConversionTimeSec}
              onChange={(e) => set("avgConversionTimeSec", Number(e.target.value))}
            />
          </div>
        </div>

        <h3>Funnel steps</h3>
        <div className="steps">
          <div className="head">Page path</div>
          <div className="head">Today</div>
          <div className="head">Typical</div>
          <div className="head">
            Clicks <span className="inert">unused</span>
          </div>
          <div />
          {form.steps.map((step, i) => (
            <StepFields
              key={i}
              step={step}
              canRemove={form.steps.length > 2}
              onChange={(patch) => setStep(i, patch)}
              onRemove={() => removeStep(i)}
            />
          ))}
        </div>
        <button type="button" className="link-btn" onClick={addStep}>
          + Add a step
        </button>

        <p className="expectation" style={{ minHeight: 0, marginTop: 10 }}>
          Order is the funnel order: landing first, purchase last. <strong>Typical</strong> is what
          the step normally gets, and it is what lets the pipeline tell a funnel that broke from one
          that always looked this way. Fields marked <span className="inert">unused</span> are
          computed by agents 1.4 and 1.5 but discarded by <code>compose</code>, so changing them
          cannot alter the digest — deciding whether they belong in it is still an open question.
        </p>
      </div>

      <div className="panel">
        <h2>History</h2>

        <div className="field">
          <label htmlFor="baseline">Prior daily visitors (oldest first, comma separated)</label>
          <textarea
            id="baseline"
            rows={3}
            value={form.baselineVisitors}
            onChange={(e) => set("baselineVisitors", e.target.value)}
          />
        </div>

        <div className="checkbox">
          <input
            id="useTypical"
            type="checkbox"
            checked={form.useTypicalFunnel}
            onChange={(e) => set("useTypicalFunnel", e.target.checked)}
          />
          <label htmlFor="useTypical" style={{ fontSize: 13, color: "inherit", margin: 0 }}>
            Send the funnel history too
            <span className="hint">
              Uncheck to simulate a first-week site. Without history a drop-off can be reported but
              can never trigger a send on its own.
            </span>
          </label>
        </div>

        <div className="field-row">
          <div>
            <label htmlFor="conversions">Orders today (blank = last funnel step)</label>
            <input
              id="conversions"
              type="text"
              inputMode="numeric"
              placeholder="derived"
              value={form.conversions}
              onChange={(e) => set("conversions", e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="typicalConversions">Orders on a typical day</label>
            <input
              id="typicalConversions"
              type="text"
              inputMode="numeric"
              placeholder="no history"
              value={form.typicalConversions}
              onChange={(e) => set("typicalConversions", e.target.value)}
            />
          </div>
        </div>

        <p className="expectation" style={{ minHeight: 0, marginTop: -4 }}>
          Leave <strong>typical</strong> blank to simulate a site with no order history: the number
          still renders, but orders can never move the gate. Orders also need to clear a volume
          floor — a swing on three orders a day is noise, not news.
        </p>

        <button type="button" className="run" onClick={onRun} disabled={running}>
          {running ? "Running the agents…" : "Run the agents"}
        </button>
      </div>
    </div>
  );
}

function StepFields({
  step,
  canRemove,
  onChange,
  onRemove,
}: {
  step: StepRow;
  canRemove: boolean;
  onChange: (patch: Partial<StepRow>) => void;
  onRemove: () => void;
}) {
  return (
    <>
      <input
        type="text"
        value={step.path}
        placeholder="/checkout"
        aria-label="Page path"
        onChange={(e) => onChange({ path: e.target.value })}
      />
      <input
        type="number"
        min={0}
        value={step.today}
        aria-label="Sessions today"
        onChange={(e) => onChange({ today: Number(e.target.value) })}
      />
      <input
        type="number"
        min={0}
        value={step.typical}
        aria-label="Typical sessions"
        onChange={(e) => onChange({ typical: Number(e.target.value) })}
      />
      <input
        type="number"
        min={0}
        value={step.clicks}
        aria-label="CTA clicks"
        onChange={(e) => onChange({ clicks: Number(e.target.value) })}
      />
      <button
        type="button"
        className="icon-btn"
        onClick={onRemove}
        disabled={!canRemove}
        aria-label={`Remove ${step.path || "step"}`}
        title="Remove step"
      >
        ×
      </button>
    </>
  );
}
