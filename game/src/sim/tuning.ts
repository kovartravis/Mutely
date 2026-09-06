/**
 * Every number in the game lives here.
 *
 * Per ADR-0001 the simulation owns the economy, which means balancing Mutely is
 * editing this file and re-running `npm run balance` -- nothing else.
 */

import { Architecture, DbEngine, Discipline, Level, Runtime, Severity, TicketType } from './types';

// ─── Stage tables ────────────────────────────────────────────────────────────

export interface StageTuning {
  key: string;
  name: string;
  /** MRR required to trigger the Funding Round into the next Stage. */
  goalMrr: number;
  /** Cash injected on entering this Stage. Stage 0's is the starting cash. */
  fundingCash: number;
  /** Multiplier on base salary bands. */
  salaryMult: number;
  /** Ticket size range in story points. */
  points: [number, number];
  /** Monthly MRR a shipped Feature returns, per story point. */
  revenuePerPoint: [number, number];
  /** Base monthly churn before bug multipliers. */
  baseChurn: number;
  /**
   * Work created per developer per Day, in story points. Expressed as points
   * rather than ticket count so the pressure stays honest as Tickets grow each
   * Stage, and scaled by team size so a bigger company generates more work.
   */
  arrivalSp: Record<TicketType, number>;
  /** Probability per Day that a Candidate applies. */
  candidateRate: number;
  /** Relative weights for rolled severity. */
  severityWeights: Record<Severity, number>;

  /** Traffic growth per Day, as a fraction (0.006 = 0.6%/day, compounding). */
  trafficDailyGrowth: number;
  /** Chance per Day of a Traffic spike. */
  trafficSpikeChance: number;
  /** Spike size range, as a multiplier applied to that Day's Traffic. */
  trafficSpikeMult: [number, number];
  /**
   * Multiplies each Developer's contribution to ticket arrival. >1 means the
   * backlog outpaces hiring as the company scales -- a bigger, later-stage
   * product generates more incoming work per head, not just more heads.
   */
  arrivalTeamMultiplier: number;
}

export const STAGES: StageTuning[] = [
  {
    key: 'garage',
    name: 'GARAGE',
    goalMrr: 12_000,
    fundingCash: 60_000,
    salaryMult: 1.0,
    points: [3, 9],
    revenuePerPoint: [70, 112],
    baseChurn: 0.024,
    arrivalSp: { feature: 0.38, bug: 0.14, tech_debt: 0.08 },
    candidateRate: 0.12,
    severityWeights: { low: 4, medium: 4, high: 2, critical: 0.6 },
    trafficDailyGrowth: 0.006,
    trafficSpikeChance: 0.010,
    trafficSpikeMult: [1.3, 1.8],
    arrivalTeamMultiplier: 1.0,
  },
  {
    key: 'seed',
    name: 'SEED',
    goalMrr: 115_000,
    fundingCash: 150_000,
    salaryMult: 1.35,
    points: [4, 11],
    revenuePerPoint: [112, 180],
    baseChurn: 0.062,
    arrivalSp: { feature: 0.42, bug: 0.17, tech_debt: 0.1 },
    candidateRate: 0.12,
    severityWeights: { low: 3, medium: 4, high: 3, critical: 1 },
    trafficDailyGrowth: 0.007,
    trafficSpikeChance: 0.012,
    trafficSpikeMult: [1.3, 2.0],
    arrivalTeamMultiplier: 1.15,
  },
  {
    key: 'series_a',
    name: 'SERIES A',
    goalMrr: 380_000,
    fundingCash: 560_000,
    salaryMult: 1.8,
    points: [5, 14],
    revenuePerPoint: [196, 306],
    baseChurn: 0.080,
    arrivalSp: { feature: 0.46, bug: 0.2, tech_debt: 0.12 },
    candidateRate: 0.13,
    severityWeights: { low: 2, medium: 4, high: 3.5, critical: 1.6 },
    trafficDailyGrowth: 0.0062,
    trafficSpikeChance: 0.013,
    trafficSpikeMult: [1.4, 2.2],
    arrivalTeamMultiplier: 1.5,
  },
  {
    key: 'ipo',
    name: 'IPO',
    goalMrr: 680_000,
    fundingCash: 2_800_000,
    salaryMult: 2.4,
    points: [6, 17],
    revenuePerPoint: [357, 552],
    baseChurn: 0.084,
    arrivalSp: { feature: 0.5, bug: 0.23, tech_debt: 0.14 },
    candidateRate: 0.13,
    severityWeights: { low: 1.5, medium: 3.5, high: 4, critical: 2.2 },
    trafficDailyGrowth: 0.0068,
    trafficSpikeChance: 0.014,
    trafficSpikeMult: [1.4, 2.5],
    arrivalTeamMultiplier: 1.9,
  },
];

// ─── Global constants ────────────────────────────────────────────────────────

export const SIM = {
  /** Days in a financial month. Cash and MRR are applied per Day at 1/30th. */
  daysPerMonth: 30,

  /** Base salary by Level, in Stage-1 dollars per month. */
  baseSalary: { junior: 4_200, mid: 6_200, senior: 8_600, staff: 11_500 } as Record<Level, number>,

  /** Story points per Day at Proficiency 100 and Morale 100, before Drag. */
  baseVelocity: { junior: 1.4, mid: 2.1, senior: 2.9, staff: 3.8 } as Record<Level, number>,

  /** Proficiency scales Velocity between these bounds (0 prof -> 0.2x, 100 -> 1.0x). */
  proficiencyFloor: 0.25,

  /** Story points shipped convert to Proficiency in that Discipline at this rate. */
  proficiencyGainPerPoint: 0.55,
  proficiencyCap: 100,

  /** PRESSURE 1 -- open bugs multiply churn by 1 + sum(weight). */
  bugChurnWeight: { low: 0.06, medium: 0.15, high: 0.32, critical: 0.62 } as Record<Severity, number>,
  /**
   * Emergency ceiling only. It must stay high: any cap the player can actually
   * reach flattens the gradient, and fixing the next bug stops paying at all.
   */
  maxChurnMultiplier: 8.0,

  /** PRESSURE 2 -- open tech debt drags team Velocity by 1 / (1 + sum(weight)). */
  debtDragWeight: { low: 0.03, medium: 0.06, high: 0.1, critical: 0.16 } as Record<Severity, number>,
  /** Floor on the Drag multiplier, so debt can cripple but never freeze the team. */
  minDrag: 0.5,

  /** Morale lost per Day while working a Ticket of this severity. */
  moraleDrain: { low: 0.12, medium: 0.35, high: 0.85, critical: 1.6 } as Record<Severity, number>,
  /** Bugs are more stressful than the same severity of feature work. */
  bugMoraleMultiplier: 1.4,
  /**
   * Recovered every Day, working or not. Without this, drain always exceeds
   * recovery for a permanently-assigned team and Morale decays to zero no matter
   * how well the player plays -- there has to be a sustainable equilibrium.
   */
  moraleBaselineRecovery: 0.45,
  /** Extra Morale recovered per fully idle Day. */
  moraleIdleRecovery: 1.5,
  /** Shipping is restorative, and more so for a big job. */
  moraleShipBase: 3,
  moraleShipPerPoint: 0.6,

  /** Below this Morale, a Developer may give Notice. */
  moraleNoticeThreshold: 35,
  /** Peak daily resignation chance, at Morale 0. */
  noticeChanceAtZero: 0.05,
  /** Days of Notice before they walk. */
  noticeDays: [4, 9] as [number, number],
  /** A retained Developer is pulled back to this Morale floor. */
  retentionMoraleFloor: 55,

  /** Morale gained per $1,000/mo of raise, and per $1,000 of one-off bonus. */
  moralePerRaiseK: 9,
  moralePerBonusK: 2.6,

  /** Days a Candidate stays available. */
  candidateLifespan: [12, 22] as [number, number],
  /** Maximum Candidates on the board at once. */
  maxCandidates: 4,
  /** Hiring costs this multiple of monthly salary up front (recruiter fee). */
  hiringFeeMonths: 0.75,
  /** Firing costs this multiple of monthly salary in severance. */
  severanceMonths: 1.0,

  /** New hires start here rather than at 100, so morale is always in play. */
  startingMorale: 85,

  /** Relative weight of each Level in a Candidate Roll. */
  levelWeights: { junior: 4, mid: 3.5, senior: 2, staff: 0.8 } as Record<Level, number>,

  /** A Candidate's Proficiency in their primary Discipline, by Level. */
  primaryProficiency: {
    junior: [25, 45],
    mid: [45, 68],
    senior: [65, 85],
    staff: [80, 96],
  } as Record<Level, [number, number]>,
  /** Fraction of primary Proficiency they carry in a secondary Discipline. */
  secondarySpread: [0.15, 0.6] as [number, number],

  /**
   * Work created regardless of team size, so a solo founder still has a
   * backlog. Raised well above what one hire's worth of throughput absorbs --
   * the backlog is meant to outpace hiring, not track it 1:1.
   */
  arrivalBaseSp: 0.4,

  /** Severity nudges Ticket size within the Stage band. */
  severitySize: { low: 0.8, medium: 1.0, high: 1.2, critical: 1.45 } as Record<Severity, number>,

  /** Days a Ticket must sit open before its first Escalation; halves each step. */
  escalationFirstDays: 30,
  /** Escalation weight added to Churn/Drag per level past what Severity already covers. */
  escalationPastCriticalWeight: 0.22,

  /** A Feature this old is withdrawn if still untouched. Wider band for low-severity work. */
  featureExpiryDays: { low: [85, 130], medium: [65, 105], high: [50, 85], critical: [38, 65] } as Record<Severity, [number, number]>,

  /** Proficiency (in the top Discipline) needed to become Promotable to the next Level. */
  promotionThreshold: { junior: 55, mid: 75, senior: 90, staff: Infinity } as Record<Level, number>,
  /** Morale gained on promotion -- real, but not a full reset. */
  promotionMoraleBoost: 15,

  /** Size of the Flavor buffer, and the level it refills at. */
  flavorTarget: 20,
  flavorRefillAt: 8,
} as const;

/**
 * Infrastructure (ADR-0004). Every Architecture has its own capacity/cost shape,
 * chosen to make each a genuinely different bet rather than the same dial with
 * a different label:
 *   - monolith: cheap and simple at small scale, cost grows superlinearly --
 *     the ceiling every company starts under and eventually outgrows.
 *   - kubernetes: a fixed cluster overhead, then cheap linear scaling per Node --
 *     better once there is enough Traffic to justify the operational floor.
 *   - serverless: cost tracks actual Traffic directly (no idle waste), but the
 *     per-request rate is pricier at real scale, and a Concurrency ceiling can
 *     still be caught out by a spike.
 */
export const INFRA = {
  trafficStart: 400,

  monolith: {
    capacityPerUnit: 1500,
    costBase: 90,
    /** > 1: cost grows faster than capacity as Tier rises. */
    costExponent: 1.32,
  },
  kubernetes: {
    capacityPerNode: 3200,
    costPerNode: 110,
    /** Cluster control-plane cost, paid regardless of Node count. */
    baseOverhead: 220,
  },
  serverless: {
    capacityPerConcurrencyUnit: 4000,
    /** Reserved-concurrency fee, independent of actual traffic served. */
    costPerConcurrencyUnit: 35,
    /** $ per million requests actually served -- this is most of the bill. */
    costPerMillionRequests: 38,
  },

  db: {
    capacityPerReplica: 3600,
    costPerReplica: 220,
  },

  /** Efficiency at Proficiency 0 and 100. Linear between. */
  efficiencyAtZero: 0.55,
  efficiencyAtMax: 1.6,

  /** PRESSURE (shared with Drag, ADR-0004): open debt inflates required Capacity. */
  debtInfraWeight: { low: 0.05, medium: 0.13, high: 0.28, critical: 0.55 } as Record<Severity, number>,

  /** Churn weight added per full unit of excess utilization (utilization 2.0 = 100% over). */
  overCapacityChurnPerUnit: 0.9,

  /**
   * Ceiling on how much open Tech Debt can inflate required Capacity. Without
   * this, escalation has no floor to fall back to: a debt ticket nobody ever
   * gets to keeps compounding forever, and required Capacity (and therefore
   * infra cost, especially on the monolith's superlinear curve) genuinely goes
   * to infinity rather than just getting very bad. Mirrors `maxChurnMultiplier`.
   */
  maxDebtInflation: 5.0,

  migration: {
    costBase: 15_000,
    /** Charged on top of the base, as a multiple of the current monthly infra bill. */
    costMonthsOfInfra: 5,
    days: [10, 16] as [number, number],
    velocityPenalty: 0.5,
    /** Compute is reset on completion to this multiple of the bare minimum needed. */
    startingSafetyMargin: 1.25,
  },

  /** Switching a Sub-architecture (ADR-0005): the same mechanism, a smaller bet. */
  subSwitch: {
    costBase: 3_000,
    costMonthsOfInfra: 1.5,
    days: [4, 7] as [number, number],
    velocityPenalty: 0.7,
  },

  cache: {
    /** Index 0 is "no cache." Buying/upgrading moves one tier at a time. */
    tiers: [
      { monthlyCost: 0, maxHitRate: 0 },
      { monthlyCost: 180, maxHitRate: 0.35 },
      { monthlyCost: 420, maxHitRate: 0.55 },
      { monthlyCost: 850, maxHitRate: 0.72 },
    ],
    /** Days after a refresh before hit rate starts decaying. */
    staleAfterDays: 25,
    /** Hit rate lost per Day once stale. */
    decayPerDay: 0.018,
    /** Below this fraction of the tier's max hit rate, staleness risks a bug. */
    integrityRiskFraction: 0.4,
    /** Daily chance of a stale-cache integrity Bug once under that fraction. */
    integrityBugChance: 0.02,
  },
} as const;

/**
 * Sub-architectures (ADR-0005): a second axis nested under the main Architecture.
 * `spDelta` is added to every rolled Ticket's story points (floored so a Ticket
 * is never smaller than 1sp); `capacityMultiplier` and `costMultiplier` scale
 * the resource it applies to. Availability of a Database engine depends on the
 * main Architecture; Runtimes are available everywhere.
 */
export interface SubArchSpec {
  label: string;
  spDelta: number;
  capacityMultiplier: number;
  costMultiplier: number;
  description: string;
}

export const DB_ENGINE_SPECS: Record<DbEngine, SubArchSpec & { availableOn: Architecture[] }> = {
  postgres: {
    label: 'Postgres',
    spDelta: 1,
    capacityMultiplier: 1.4,
    costMultiplier: 1.0,
    description: 'Relational discipline slows every ticket slightly; serves traffic efficiently once built.',
    availableOn: ['monolith', 'kubernetes'],
  },
  mongo: {
    label: 'Mongo',
    spDelta: 0,
    capacityMultiplier: 0.9,
    costMultiplier: 1.0,
    description: 'Flexible schema, nothing slows tickets down -- but scales traffic less efficiently per replica.',
    availableOn: ['monolith', 'kubernetes', 'serverless'],
  },
  managed: {
    label: 'Managed',
    spDelta: 1,
    capacityMultiplier: 1.6,
    costMultiplier: 1.35,
    description: 'A fully managed cloud database. Excellent at scale, and it costs like it.',
    availableOn: ['kubernetes', 'serverless'],
  },
};

export const RUNTIME_SPECS: Record<Runtime, SubArchSpec> = {
  node: {
    label: 'Node',
    spDelta: 0,
    capacityMultiplier: 1.0,
    costMultiplier: 1.0,
    description: 'Balanced default. No strong trade-off either way.',
  },
  go: {
    label: 'Go',
    spDelta: 1,
    capacityMultiplier: 1.35,
    costMultiplier: 1.0,
    description: 'Compiled and efficient under load; slower to build against.',
  },
  python: {
    label: 'Python',
    spDelta: -1,
    capacityMultiplier: 0.75,
    costMultiplier: 0.92,
    description: 'Fast to ship; costs more capacity per unit of traffic served.',
  },
};

/** Mean story points of a Ticket rolled in this Stage, used to convert sp/day into arrivals. */
export function expectedTicketPoints(stage: StageTuning): number {
  const [lo, hi] = stage.points;
  const midpoint = (lo + hi) / 2;
  const weights = Object.entries(stage.severityWeights) as Array<[Severity, number]>;
  const total = weights.reduce((sum, [, w]) => sum + w, 0);
  const sizeFactor = weights.reduce((sum, [sev, w]) => sum + SIM.severitySize[sev] * w, 0) / total;
  return Math.max(1, midpoint * sizeFactor);
}

export function stageAt(index: number): StageTuning {
  return STAGES[Math.min(index, STAGES.length - 1)];
}

export function salaryFor(level: Level, stageIndex: number, jitter: number): number {
  const base = SIM.baseSalary[level] * stageAt(stageIndex).salaryMult;
  return Math.round((base * (0.9 + jitter * 0.25)) / 100) * 100;
}

/** Disciplines are equally likely; kept as a function so weighting can be added per Stage. */
export function disciplineWeights(): ReadonlyArray<readonly [Discipline, number]> {
  return [
    ['frontend', 1],
    ['backend', 1],
    ['devops', 0.8],
    ['ml', 0.6],
    ['dba', 0.7],
  ];
}
