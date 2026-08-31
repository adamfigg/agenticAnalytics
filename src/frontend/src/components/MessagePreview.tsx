// The two things that actually reach a customer, rendered as they would arrive,
// each with a button to send it for real.
//
// Both bodies are read straight off the digest object — `emailBody` and
// `smsBody` as step 3 built them. Nothing is re-composed for display, because a
// preview that reformats its input is not a preview, and what you send must be
// exactly what you were shown.
import { useState } from "react";
import type { Digest } from "../../../shared/types";
import { sendDigest, type BenchEnv, type SendResult } from "../bench/api";

export function MessagePreview({
  digest,
  env,
  emailHtml,
}: {
  digest: Digest;
  env: BenchEnv;
  emailHtml: string | null;
}) {
  if (!digest.shouldSend) {
    return (
      <div className="panel messages">
        <h2>What would be sent</h2>
        <div className="empty">
          Nothing. The gate closed before step 3, so no copy was written and no message exists to
          preview — which is the intended outcome for a day like this.
        </div>
      </div>
    );
  }

  const sms = digest.smsBody ?? "";

  return (
    <div className="panel messages">
      <h2>What would be sent</h2>
      <div className="messages-grid">
        <div>
          <h3 style={{ marginTop: 0 }}>Email</h3>
          <div className="email">
            <div className="email-head">
              <div className="from">From: SmallBiz Analytics</div>
              <div className="from">To: the owner of {digest.siteId}</div>
              <div className="subject">{digest.headline}</div>
            </div>
            {emailHtml ? (
              // The real rendered email, sandboxed. This is byte-for-byte what
              // Resend is handed, so what you approve here is what ships.
              <iframe
                className="email-frame"
                title="Email preview"
                sandbox=""
                srcDoc={emailHtml}
              />
            ) : (
              <div className="email-body">{digest.emailBody}</div>
            )}
          </div>

          <SendBox
            channel="email"
            label="Send email"
            placeholder="owner@example.com"
            inputType="email"
            configured={env.emailConfigured}
            setupHint="Add RESEND_API_KEY to .env. Resend's free tier covers 3,000 emails a month."
            digest={digest}
          />
        </div>

        <div>
          <h3 style={{ marginTop: 0 }}>Text message</h3>
          <div className="phone">
            <div className="bubble">{sms}</div>
          </div>
          <div className="sms-meta">
            <span className={sms.length > 160 ? "over" : undefined}>
              {sms.length} / 160 characters
            </span>
            <span>a link is appended by the delivery layer</span>
          </div>

          {/* SMS is on hold. The delivery module and the endpoint still work —
              only the button is parked, so turning it back on is deleting this
              block. Nothing about the SMS copy path has been removed. */}
          <p className="sendbox-note">
            <strong>Sending is on hold.</strong> The copy above is still generated every run. Turning
            it on needs Twilio credentials and, for US numbers, A2P 10DLC registration.
          </p>
        </div>
      </div>
    </div>
  );
}

function SendBox({
  channel,
  label,
  placeholder,
  inputType,
  configured,
  setupHint,
  digest,
}: {
  channel: "email" | "sms";
  label: string;
  placeholder: string;
  inputType: "email" | "tel";
  configured: boolean;
  setupHint: string;
  digest: Digest;
}) {
  const [to, setTo] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);

  async function send(): Promise<void> {
    setSending(true);
    setResult(null);
    try {
      setResult(await sendDigest(channel, to.trim(), digest));
    } catch (err) {
      setResult({
        ok: false,
        configured: true,
        reason: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="sendbox">
      <div className="sendbox-row">
        <input
          type={inputType}
          value={to}
          placeholder={placeholder}
          aria-label={`${label} recipient`}
          onChange={(e) => setTo(e.target.value)}
          disabled={!configured}
        />
        <button
          type="button"
          className="send-btn"
          // No recipient means no send. There is no default destination on
          // purpose — nothing should go out because a field was left populated.
          disabled={!configured || sending || to.trim() === ""}
          onClick={() => void send()}
        >
          {sending ? "Sending…" : label}
        </button>
      </div>

      {!configured && <p className="sendbox-note">Not configured. {setupHint}</p>}

      {result && (
        <p className={`sendbox-note ${result.ok ? "ok" : "bad"}`}>
          {result.ok
            ? `Sent${result.detail ? ` — ${result.detail}` : ""}${result.id ? ` · ${result.id}` : ""}`
            : `Failed: ${result.reason}`}
        </p>
      )}
    </div>
  );
}
