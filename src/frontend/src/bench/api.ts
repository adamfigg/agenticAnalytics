// Talking to the bench endpoint. The result shape is declared here against the
// shared contracts rather than imported from the backend, so no server module is
// ever pulled into the browser bundle.
import type { Digest, SiteData, Step1Bundle } from "../../../shared/types";
import { toDayShape, type BenchForm } from "./scenarios";

export interface BenchResult {
  siteData: SiteData;
  step1: Step1Bundle;
  digest: Digest;
  usedModel: boolean;
  baseUrl: string;
  emailHtml: string | null;
  elapsedMs: number;
}

export async function runBench(form: BenchForm): Promise<BenchResult> {
  const res = await fetch("/api/bench", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(toDayShape(form)),
  });

  const payload = await res.json().catch(() => ({ error: "the bench returned invalid JSON" }));
  if (!res.ok) throw new Error(payload.error ?? `request failed (${res.status})`);
  return payload as BenchResult;
}

export interface BenchEnv {
  hasApiKey: boolean;
  baseUrl: string;
  emailConfigured: boolean;
  smsConfigured: boolean;
}

const NO_ENV: BenchEnv = {
  hasApiKey: false,
  baseUrl: "",
  emailConfigured: false,
  smsConfigured: false,
};

export async function fetchEnv(): Promise<BenchEnv> {
  try {
    const res = await fetch("/api/bench-env");
    if (!res.ok) return NO_ENV;
    return (await res.json()) as BenchEnv;
  } catch {
    return NO_ENV;
  }
}

export interface SendResult {
  ok: boolean;
  id?: string;
  reason?: string;
  detail?: string;
  configured: boolean;
}

export async function sendDigest(
  channel: "email" | "sms",
  to: string,
  digest: Digest,
): Promise<SendResult> {
  const res = await fetch("/api/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ channel, to, digest }),
  });
  return (await res.json().catch(() => ({
    ok: false,
    configured: true,
    reason: "the server returned invalid JSON",
  }))) as SendResult;
}
