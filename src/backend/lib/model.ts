// Thin wrapper around the Anthropic API. Every LLM agent goes through here so the
// model choice, retries, and JSON parsing live in ONE place.
import Anthropic from "@anthropic-ai/sdk";
import { anthropicBaseUrl } from "./env";

/** The only endpoint this product is designed to talk to. */
const ANTHROPIC_API = "https://api.anthropic.com";

// Built on first use, not at import time. Constructing it eagerly would capture
// ANTHROPIC_API_KEY before .env had a chance to load, so a correctly configured
// project would still behave as though no key were set.
let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (client) return client;

  const baseURL = anthropicBaseUrl();
  if (!baseURL.startsWith(ANTHROPIC_API)) {
    // Loud on purpose. A redirected base URL sends a real Anthropic key to a
    // third party and comes back as an authentication error that reads like a
    // bad key, which is a genuinely expensive thing to debug. Pin
    // ANTHROPIC_BASE_URL in .env to override whatever the shell is carrying.
    console.warn(
      `[model] WARNING: calls are going to ${baseURL}, not ${ANTHROPIC_API}. ` +
        `Your Anthropic key will be rejected there.`,
    );
  }

  // apiKey and baseURL are passed explicitly rather than left to the SDK's
  // ambient resolution, so a stray ANTHROPIC_AUTH_TOKEN or base URL in the
  // environment cannot quietly change where the key is sent.
  client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, baseURL });
  return client;
}

export interface ModelCall {
  model: string;
  system: string;
  input: string;
  maxTokens?: number;
}

export async function runModel(call: ModelCall): Promise<{ text: string }> {
  const res = await getClient().messages.create({
    model: call.model,
    max_tokens: call.maxTokens ?? 1024,
    system: call.system,
    messages: [{ role: "user", content: call.input }],
  });
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  return { text };
}

// Helper for agents that must return JSON. Strips code fences and parses safely.
export function parseJson<T>(raw: string): T {
  const clean = raw.replace(/```json|```/g, "").trim();
  return JSON.parse(clean) as T;
}
