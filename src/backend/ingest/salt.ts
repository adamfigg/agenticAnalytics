// Visitor identity. The whole privacy promise rests on this file.
//
// There is no cookie and no visitor ID. A visitor is identified, for one day
// only, by a hash of IP + user-agent + a salt that rotates at midnight. When
// the salt rotates the previous salt is destroyed, which makes yesterday's
// hashes permanently unrecomputable — nobody, including us, can link a visitor
// across two days or work backwards from a hash to an IP.
//
// This is the Plausible/Fathom model, and it is what lets us tell a customer
// they need no cookie banner. See CLAUDE.md -> "Hard constraints".
import { createHash, randomBytes } from "node:crypto";

/**
 * The live salt. Exactly one salt exists at a time: rotating replaces it, and
 * the old bytes are zeroed before being dropped so they cannot be recovered
 * from the heap. In production this belongs in a KV store with a hard TTL, and
 * the rotation must be driven by a scheduled job at the client's local midnight
 * rather than lazily on first request.
 */
let current: { date: string; bytes: Buffer } | null = null;

function rotateTo(date: string): Buffer {
  if (current) {
    // Destroy the previous salt. Once this runs, every hash derived from it is
    // permanently unverifiable — that is the point, not a side effect.
    current.bytes.fill(0);
  }
  current = { date, bytes: randomBytes(32) };
  return current.bytes;
}

function saltFor(date: string): Buffer {
  if (current && current.date === date) return current.bytes;
  return rotateTo(date);
}

/**
 * Derive today's visitor hash. Used only to count *distinct* visitors within a
 * single day. The hash itself is never written to durable storage — only the
 * resulting counts are. See `store.ts`.
 */
export function visitorHash(ip: string, userAgent: string, date: string): string {
  return createHash("sha256")
    .update(saltFor(date))
    .update("\0") // domain separator: keeps ip+ua concatenation unambiguous
    .update(ip)
    .update("\0")
    .update(userAgent)
    .digest("hex");
}

/** Test hook: force rotation so a test can prove yesterday's hash is unrecoverable. */
export function _rotateForTest(date: string): void {
  rotateTo(date);
}
