/**
 * Save Slots, backed by localStorage. One automatic slot always tracks the live
 * Run for crash recovery; named slots are the player's own and load freely.
 */

import { deserialise, RunState, serialise } from '@/sim';

const PREFIX = 'mutely.save.';
export const AUTOSAVE = '__auto';

const key = (name: string) => `${PREFIX}${name}`;
const available = () => typeof window !== 'undefined' && !!window.localStorage;

export interface SaveInfo {
  name: string;
  day: number;
  stageIndex: number;
  cash: number;
  mrr: number;
  savedAt: number;
}

export function writeSave(name: string, state: RunState): boolean {
  if (!available()) return false;
  try {
    localStorage.setItem(key(name), serialise({ ...state, speed: 0 }));
    localStorage.setItem(`${key(name)}.meta`, JSON.stringify({
      name, day: state.day, stageIndex: state.stageIndex,
      cash: state.cash, mrr: state.mrr, savedAt: Date.now(),
    } satisfies SaveInfo));
    return true;
  } catch {
    return false;
  }
}

export function readSave(name: string): RunState | null {
  if (!available()) return null;
  try {
    const raw = localStorage.getItem(key(name));
    return raw ? deserialise(raw) : null;
  } catch {
    return null;
  }
}

export function listSaves(): SaveInfo[] {
  if (!available()) return [];
  const out: SaveInfo[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(PREFIX) || !k.endsWith('.meta')) continue;
    try {
      const info = JSON.parse(localStorage.getItem(k) ?? '') as SaveInfo;
      if (info?.name && info.name !== AUTOSAVE) out.push(info);
    } catch { /* skip unreadable slot */ }
  }
  return out.sort((a, b) => b.savedAt - a.savedAt);
}

export function saveNames(): string[] {
  return listSaves().map((s) => s.name);
}
