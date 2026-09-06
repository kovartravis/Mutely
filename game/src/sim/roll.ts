/**
 * Rolls -- the simulation generating game objects from the current Stage's
 * Tuning Table (ADR-0001). Every number an object carries originates here.
 * Flavor is attached afterwards and is purely cosmetic.
 */

import { popPersonFlavor, popTicketFlavor } from './flavor';
import { developerHandle, nextTicketHandle } from './handles';
import { Rng } from './rng';
import { DB_ENGINE_SPECS, disciplineWeights, RUNTIME_SPECS, salaryFor, SIM, stageAt } from './tuning';
import {
  Candidate, Developer, Discipline, DISCIPLINES, Level, LEVELS,
  ProficiencyMap, RunState, Severity, Ticket, TicketType,
} from './types';

const nextId = (state: RunState, prefix: string) => `${prefix}${state.idSeq++}`;

function rollSeverity(state: RunState, rng: Rng): Severity {
  const weights = stageAt(state.stageIndex).severityWeights;
  return rng.weighted(Object.entries(weights) as Array<[Severity, number]>)!;
}

function rollDiscipline(rng: Rng): Discipline {
  return rng.weighted(disciplineWeights())!;
}

export function rollTicket(state: RunState, rng: Rng, type: TicketType): Ticket {
  const stage = stageAt(state.stageIndex);
  const severity = rollSeverity(state, rng);
  const discipline = rollDiscipline(rng);

  const [minP, maxP] = stage.points;
  // The chosen Sub-architectures add friction (or shave it off) on every
  // Ticket, not just infra-flavored ones -- Postgres discipline or a compiled
  // Runtime slows the whole team down a little, always.
  const subDelta = DB_ENGINE_SPECS[state.infra.dbEngine].spDelta + RUNTIME_SPECS[state.infra.runtime].spDelta;
  const storyPoints = Math.max(1, Math.round(rng.int(minP, maxP) * SIM.severitySize[severity]) + subDelta);

  const revenue =
    type === 'feature'
      ? Math.round((storyPoints * rng.float(...stage.revenuePerPoint)) / 10) * 10
      : 0;

  const expiresDay =
    type === 'feature' ? state.day + rng.int(...SIM.featureExpiryDays[severity]) : null;

  const { title, description } = popTicketFlavor(state.flavor, rng, type, discipline);

  return {
    id: nextId(state, 't'),
    handle: nextTicketHandle(state),
    title,
    description,
    type,
    severity,
    discipline,
    storyPoints,
    progressPoints: 0,
    revenue,
    status: 'backlog',
    assignedTo: null,
    createdDay: state.day,
    completedDay: null,
    escalationLevel: 0,
    expiresDay,
  };
}

function rollProficiency(rng: Rng, level: Level): ProficiencyMap {
  const primary = rollDiscipline(rng);
  const [lo, hi] = SIM.primaryProficiency[level];
  const peak = rng.int(lo, hi);

  const map = {} as ProficiencyMap;
  for (const d of DISCIPLINES) {
    map[d] = d === primary ? peak : Math.round(peak * rng.float(...SIM.secondarySpread));
  }
  return map;
}

export function rollCandidate(state: RunState, rng: Rng): Candidate {
  const level = rng.weighted(Object.entries(SIM.levelWeights) as Array<[Level, number]>)!;
  const proficiency = rollProficiency(rng, level);
  const { name, blurb } = popPersonFlavor(state.flavor, rng);

  const taken = [
    ...state.developers.map((d) => d.handle),
    ...state.candidates.map((c) => c.handle),
  ];

  return {
    id: nextId(state, 'c'),
    handle: developerHandle(name, taken),
    name,
    level,
    proficiency,
    salary: salaryFor(level, state.stageIndex, rng.next()),
    blurb,
    expiresDay: state.day + rng.int(...SIM.candidateLifespan),
  };
}

/** The founding engineer, so a Run never starts with an empty team. */
export function rollFounder(state: RunState, rng: Rng): Developer {
  const level: Level = 'mid';
  const { name } = popPersonFlavor(state.flavor, rng);
  return {
    id: nextId(state, 'd'),
    handle: developerHandle(name, []),
    name,
    level,
    proficiency: rollProficiency(rng, level),
    salary: salaryFor(level, 0, rng.next()),
    morale: 92,
    currentTicketId: null,
    noticeDaysLeft: null,
    joinedDay: 0,
  };
}

export function hireCandidate(state: RunState, candidate: Candidate): Developer {
  return {
    id: nextId(state, 'd'),
    handle: candidate.handle,
    name: candidate.name,
    level: candidate.level,
    proficiency: { ...candidate.proficiency },
    salary: candidate.salary,
    morale: SIM.startingMorale,
    currentTicketId: null,
    noticeDaysLeft: null,
    joinedDay: state.day,
  };
}

/** Display-only archetype, derived from Proficiency rather than stored (CONTEXT.md: Discipline). */
export function topDiscipline(p: ProficiencyMap): Discipline {
  return DISCIPLINES.reduce((best, d) => (p[d] > p[best] ? d : best), DISCIPLINES[0]);
}

export function levelLabel(level: Level): string {
  return LEVELS.includes(level) ? level : 'mid';
}

/** The Level one tier up, or null once already staff. */
export function nextLevel(level: Level): Level | null {
  const idx = LEVELS.indexOf(level);
  return idx >= 0 && idx < LEVELS.length - 1 ? LEVELS[idx + 1] : null;
}

/** Promotable is derived from Proficiency, not stored (CONTEXT.md: Promotable). */
export function isPromotable(dev: Developer): boolean {
  if (nextLevel(dev.level) === null) return false;
  const top = topDiscipline(dev.proficiency);
  return dev.proficiency[top] >= SIM.promotionThreshold[dev.level];
}
