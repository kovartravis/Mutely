/**
 * Seeded, serialisable RNG.
 *
 * A Run's Seed plus its cursor fully determine every Roll, so a Run can be
 * saved, reloaded, and replayed identically -- which is what makes the
 * balance harness meaningful.
 */

export interface RngState {
  seed: number;
  cursor: number;
}

export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** Float in [min, max). */
  float(min: number, max: number): number;
  /** True with probability p. */
  chance(p: number): boolean;
  /** Uniform pick. Returns undefined for an empty list. */
  pick<T>(items: readonly T[]): T | undefined;
  /** Weighted pick over [item, weight] pairs. */
  weighted<T>(entries: ReadonlyArray<readonly [T, number]>): T | undefined;
  /** Current position, for serialising back into state. */
  state(): RngState;
}

/** mulberry32 -- small, fast, good enough for a game, and trivially seedable. */
function mulberry32(a: number): number {
  a = (a + 0x6d2b79f5) | 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function createRng(seed: number, cursor = 0): Rng {
  let pos = cursor;

  const next = () => mulberry32((seed + pos++ * 0x9e3779b9) | 0);

  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    float: (min, max) => min + next() * (max - min),
    chance: (p) => next() < p,
    pick: (items) => (items.length === 0 ? undefined : items[Math.floor(next() * items.length)]),
    weighted: (entries) => {
      const total = entries.reduce((sum, [, w]) => sum + w, 0);
      if (total <= 0) return undefined;
      let roll = next() * total;
      for (const [item, weight] of entries) {
        roll -= weight;
        if (roll < 0) return item;
      }
      return entries[entries.length - 1][0];
    },
    state: () => ({ seed, cursor: pos }),
  };
}

/** Derives a fresh seed from an existing Rng, for sub-streams. */
export function deriveSeed(rng: Rng): number {
  return Math.floor(rng.next() * 0xffffffff);
}
