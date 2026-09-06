/**
 * Handles are the player's address for a game object (ADR-0002). They are short,
 * stable for the object's lifetime, and never reused within a Run.
 */

import { RunState } from './types';

const ALPHABET = 'abcdefghijkmnpqrstuvwxyz'; // no l/o, which read as 1/0

/** Ticket Handles: a1, a2, ... a9, b1, ... Rendered as "#a3". */
export function nextTicketHandle(state: RunState): string {
  const n = state.handleSeq++;
  const letter = ALPHABET[Math.floor(n / 9) % ALPHABET.length];
  return `${letter}${(n % 9) + 1}`;
}

/** Developer Handles: first name, lowercased, suffixed on collision. */
export function developerHandle(name: string, taken: readonly string[]): string {
  const base = name.split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9]/g, '') || 'dev';
  if (!taken.includes(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}${i}`;
    if (!taken.includes(candidate)) return candidate;
  }
}

/** Resolves "@marcus", "marcus", "#a3" or "a3" against the Run. */
export function resolveDeveloper(state: RunState, token: string) {
  const h = token.replace(/^@/, '').toLowerCase();
  return state.developers.find((d) => d.handle === h) ?? null;
}

export function resolveCandidate(state: RunState, token: string) {
  const h = token.replace(/^@/, '').toLowerCase();
  return state.candidates.find((c) => c.handle === h) ?? null;
}

export function resolveTicket(state: RunState, token: string) {
  const h = token.replace(/^#/, '').toLowerCase();
  return state.tickets.find((t) => t.handle === h) ?? null;
}
