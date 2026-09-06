/**
 * Creating and serialising a Run. A save is JSON.stringify(RunState) -- there is
 * no separate save format (ADR-0003).
 */

import { emptyQueue } from './flavor';
import { createRng } from './rng';
import { rollFounder, rollTicket } from './roll';
import { INFRA, STAGES } from './tuning';
import { RunState } from './types';

export const RUN_VERSION = 5;

export function newRun(companyName = 'NEBULASTACK', seed = Math.floor(Math.random() * 0xffffffff)): RunState {
  const state: RunState = {
    version: RUN_VERSION,
    companyName: companyName.toUpperCase(),
    rng: { seed, cursor: 0 },
    day: 1,
    stageIndex: 0,
    status: 'running',
    speed: 1,
    autoAssign: false,
    infra: {
      architecture: 'monolith',
      dbEngine: 'postgres',
      runtime: 'node',
      compute: 1,
      dbReplicas: 1,
      traffic: INFRA.trafficStart,
      trafficBaseline: INFRA.trafficStart,
      cache: { active: false, tier: 0, hitRate: 0, lastRefreshedDay: 1 },
      pending: null,
    },
    cash: STAGES[0].fundingCash,
    mrr: 0,
    developers: [],
    candidates: [],
    tickets: [],
    events: [],
    flavor: emptyQueue(),
    handleSeq: 0,
    idSeq: 1,
  };

  const rng = createRng(seed, 0);

  state.developers.push(rollFounder(state, rng));
  // A starting backlog, so day one is a decision rather than a wait.
  for (const type of ['feature', 'feature', 'tech_debt'] as const) {
    state.tickets.push(rollTicket(state, rng, type));
  }

  state.rng = rng.state();
  state.events.push({
    id: `e${state.idSeq++}`,
    day: 1,
    level: 'info',
    text: `${state.companyName} founded. Goal: $${STAGES[0].goalMrr.toLocaleString()}/mo MRR. Type /help.`,
  });

  return state;
}

export function serialise(state: RunState): string {
  return JSON.stringify(state);
}

/**
 * Each step fills in only what that version was missing, so a save from
 * several versions back upgrades through each step rather than being
 * discarded outright.
 */
function migrate(parsed: { version: number } & Record<string, unknown>): RunState | null {
  let state = parsed;

  if (state.version === 2) {
    state = { ...state, version: 3, autoAssign: false };
  }
  if (state.version === 3) {
    state = {
      ...state,
      version: 4,
      infra: {
        architecture: 'monolith',
        compute: 1,
        dbReplicas: 1,
        traffic: INFRA.trafficStart,
        migratingTo: null,
        migrationDaysLeft: null,
      },
    };
  }
  if (state.version === 4) {
    const oldInfra = state.infra as Record<string, unknown>;
    state = {
      ...state,
      version: 5,
      infra: {
        ...oldInfra,
        dbEngine: 'postgres',
        runtime: 'node',
        cache: { active: false, tier: 0, hitRate: 0, lastRefreshedDay: (state as { day?: number }).day ?? 1 },
        pending: null,
      },
      tickets: ((state.tickets as unknown[]) ?? []).map((t) => ({
        ...(t as Record<string, unknown>),
        escalationLevel: 0,
        expiresDay: null,
      })),
    };
    // The old migratingTo/migrationDaysLeft pair no longer exists on Infra.
    delete (state.infra as Record<string, unknown>).migratingTo;
    delete (state.infra as Record<string, unknown>).migrationDaysLeft;
  }

  return state.version === RUN_VERSION ? (state as unknown as RunState) : null;
}

export function deserialise(json: string): RunState | null {
  try {
    const parsed = JSON.parse(json) as { version: number } & Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return null;

    const migrated = migrate(parsed);
    if (!migrated) return null;
    // Never resume mid-flight; the player should choose to start the clock.
    return { ...migrated, speed: 0 };
  } catch {
    return null;
  }
}
