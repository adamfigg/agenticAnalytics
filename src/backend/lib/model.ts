// Thin wrapper around the Anthropic API. Every LLM agent goes through here so the
// model choice, retries, and JSON parsing live in ONE place.
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface ModelCall {
  model: string;
  system: string;
  input: string;
  maxTokens?: number;
}

export async function runModel(call: ModelCall): Promise<{ text: string }> {
  const res = await client.messages.create({
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
