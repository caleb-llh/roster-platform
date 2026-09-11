/**
 * Deterministic pseudo-random number generator (mulberry32).
 *
 * A tiny seeded PRNG so that randomized initialization / search remains fully
 * reproducible: the same seed yields the same sequence, which keeps roster
 * generation deterministic for a given input.
 */
export function createRng(seed) {
  let a = seed >>> 0
  const rng = () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  // Integer in [0, n)
  rng.int = (n) => Math.floor(rng() * n)
  // Fisher-Yates shuffle (returns a new array), using this RNG.
  rng.shuffle = (arr) => {
    const out = [...arr]
    for (let i = out.length - 1; i > 0; i--) {
      const j = rng.int(i + 1)
      ;[out[i], out[j]] = [out[j], out[i]]
    }
    return out
  }
  return rng
}
