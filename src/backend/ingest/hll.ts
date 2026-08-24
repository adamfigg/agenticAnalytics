// HyperLogLog: distinct-visitor counting that never retains the visitors.
//
// Counting "how many different people came today" normally means keeping the set
// of who you've seen. We don't want that set to exist — not in a database, not
// even in a cache. A HyperLogLog keeps a fixed-size sketch of registers instead:
// each visitor hash nudges at most one register, and the count is reconstructed
// from the register distribution. The sketch is one-way and holds no hashes, so
// there is no visitor list to leak, subpoena, or accidentally log.
//
// See CLAUDE.md -> "Hard constraints".

/** 2^14 registers = 16KB per open sketch. Sketches are discarded when a day closes. */
export const HLL_PRECISION = 14;
export const HLL_REGISTERS = 1 << HLL_PRECISION;

/** Bias constant for the harmonic-mean estimator at this register count. */
const ALPHA = 0.7213 / (1 + 1.079 / HLL_REGISTERS);

/** Registers are one byte, so a rank this high can never overflow one. */
const MAX_RANK_BITS = 64;

/** Hex characters needed to carry HLL_PRECISION bits of register index. */
const INDEX_NIBBLES = Math.ceil(HLL_PRECISION / 4);

export function emptySketch(): Uint8Array {
  return new Uint8Array(HLL_REGISTERS);
}

/**
 * Position of the leftmost 1-bit in `hex` starting at `from`, one-based.
 *
 * The visitor hash is already a uniformly distributed SHA-256 digest, so its
 * bits can be used directly — there is no need to hash it a second time.
 */
function rankOf(hex: string, from: number): number {
  let zeros = 0;
  for (let i = from; i < hex.length && zeros < MAX_RANK_BITS; i++) {
    const nibble = parseInt(hex[i]!, 16);
    if (Number.isNaN(nibble)) break;
    if (nibble === 0) {
      zeros += 4;
      continue;
    }
    // Leading zeros within this 4-bit nibble.
    zeros += Math.clz32(nibble) - 28;
    break;
  }
  return Math.min(zeros, MAX_RANK_BITS) + 1;
}

/**
 * Fold one visitor hash into the sketch. Returns true if the sketch changed,
 * which is useful only for skipping redundant writes — never treat it as
 * "this visitor was new", because an already-counted visitor can also fail to
 * move a register.
 */
export function sketchAdd(sketch: Uint8Array, digestHex: string): boolean {
  if (digestHex.length < INDEX_NIBBLES + 1) return false;

  // The leading HLL_PRECISION bits pick the register; the rest supply the rank.
  // Derived from the constant rather than hardcoded — reading a fixed number of
  // hex characters here would silently leave most registers unreachable the
  // moment HLL_PRECISION changed, which quietly destroys the estimate.
  const leading = parseInt(digestHex.slice(0, INDEX_NIBBLES), 16);
  if (Number.isNaN(leading)) return false;
  const index = leading >>> (INDEX_NIBBLES * 4 - HLL_PRECISION);

  const rank = rankOf(digestHex, INDEX_NIBBLES);
  if (rank > (sketch[index] ?? 0)) {
    sketch[index] = rank;
    return true;
  }
  return false;
}

/**
 * Estimated distinct count.
 *
 * Small-business traffic lives entirely in the range where the raw estimator is
 * poor and linear counting is near-exact, so the small-range correction below is
 * the one that actually matters for us: at a few hundred visitors against 4096
 * registers, this returns the true count essentially every time.
 */
export function sketchCount(sketch: Uint8Array): number {
  let harmonic = 0;
  let zeroRegisters = 0;

  for (let i = 0; i < HLL_REGISTERS; i++) {
    const r = sketch[i] ?? 0;
    if (r === 0) zeroRegisters++;
    harmonic += 2 ** -r;
  }

  const estimate = (ALPHA * HLL_REGISTERS * HLL_REGISTERS) / harmonic;

  // Small-range correction. Below ~2.5m the raw estimator is biased, but empty
  // registers are still informative, so count those instead.
  if (estimate <= 2.5 * HLL_REGISTERS && zeroRegisters > 0) {
    return Math.round(HLL_REGISTERS * Math.log(HLL_REGISTERS / zeroRegisters));
  }

  // The large-range correction for 32-bit hashes is deliberately omitted: it
  // only applies near 2^32 cardinality, which no small-business site reaches.
  return Math.round(estimate);
}

/**
 * Union of two sketches, register-wise. This is what makes the weekly roll-up
 * possible: seven daily sketches merge into a true weekly distinct count, which
 * summing daily counts could never give you.
 */
export function sketchMerge(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = emptySketch();
  for (let i = 0; i < HLL_REGISTERS; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    out[i] = av > bv ? av : bv;
  }
  return out;
}
