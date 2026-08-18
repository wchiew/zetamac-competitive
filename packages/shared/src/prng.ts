/**
 * Deterministic PRNG shared by client and server.
 *
 * Every player in a lobby derives the identical problem sequence from the same
 * seed, and the server re-derives it to validate scores. That only holds if
 * this implementation is bit-for-bit identical everywhere, so it lives in
 * shared code and must never be reimplemented per-app.
 *
 * mulberry32: 32-bit state, uniform output, fast enough to be free.
 */
export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Inclusive on both ends. */
export function randInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)]!;
}

/** A fresh seed for a new game. Server-side in multiplayer; local in solo. */
export function randomSeed(): number {
  return (Math.random() * 0x100000000) >>> 0;
}
