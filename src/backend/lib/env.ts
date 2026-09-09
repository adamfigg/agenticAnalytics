// Load .env into process.env, and make it authoritative.
//
// Node's built-in process.loadEnvFile does NOT override variables already set in
// the shell — the shell wins. That is the wrong precedence for this project. A
// developer machine often carries ANTHROPIC_BASE_URL or ANTHROPIC_AUTH_TOKEN
// from some gateway or proxy setup, and those would silently redirect our API
// calls somewhere other than Anthropic, producing an authentication error that
// looks like a bad key but isn't. A project-local .env should beat an inherited
// shell var, so this parses and force-sets instead.
//
// Import for the side effect:  import "../lib/env";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ENV_PATH = resolve(process.cwd(), ".env");

/** Minimal KEY=VALUE parser. No interpolation — .env is config, not a script. */
function parse(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim().replace(/^export\s+/, "");
    let value = line.slice(eq + 1).trim();

    // Strip one matching pair of surrounding quotes. Without this the quotes
    // become part of the value, which is a genuinely hard bug to spot.
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (quoted && value.length >= 2) value = value.slice(1, -1);

    if (key) out.set(key, value);
  }
  return out;
}

if (existsSync(ENV_PATH)) {
  try {
    const overridden: string[] = [];
    for (const [key, value] of parse(readFileSync(ENV_PATH, "utf8"))) {
      if (process.env[key] !== undefined && process.env[key] !== value) {
        overridden.push(key);
      }
      process.env[key] = value;
    }
    if (overridden.length > 0) {
      // Names only, never values. Silent precedence changes are how an hour
      // disappears into "but the key is right there in the file".
      console.warn(`[env] .env overrode inherited shell vars: ${overridden.join(", ")}`);
    }
  } catch (err) {
    console.warn(`[env] could not read ${ENV_PATH}: ${(err as Error).message}`);
  }
}

/** True when a real Anthropic key is configured. */
export function hasAnthropicKey(): boolean {
  const key = process.env.ANTHROPIC_API_KEY;
  return typeof key === "string" && key.trim().length > 0;
}

/**
 * Where API calls will actually go. Surfaced so a misconfigured proxy shows up
 * as a visible endpoint rather than as a confusing authentication failure.
 */
export function anthropicBaseUrl(): string {
  return process.env.ANTHROPIC_BASE_URL?.trim() || "https://api.anthropic.com";
}
