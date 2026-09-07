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
  /**
   * Work created regardless of headcount, per Stage. This is the lever for
   * "you genuinely cannot do this alone" -- unlike arrivalTeamMultiplier, it
   * does not scale with team size, so raising it hits a team of one hard
   * without proportionally punishing a team that already hired.
   */
  arrivalBaseSp: number;
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
    baseChurn: 0.018,
    arrivalSp: { feature: 0.38, bug: 0.15, tech_debt: 0.09 },
    candidateRate: 0.12,
    severityWeights: { low: 4, medium: 4, high: 2, critical: 0.6 },
    trafficDailyGrowth: 0.006,
    trafficSpikeChance: 0.010,
    trafficSpikeMult: [1.3, 1.8],
    arrivalTeamMultiplier: 1.15,
    // Lowered from 0.5: that value was tuned specifically to force a second
    // hire, but the harness showed it also left a solo/duo founder pinned at
    // or just past their own capacity for months, with no slack to ever go
    // idle and recover Morale (see moraleBaselineRecovery below). Still well
    // above a true one-person-can-coast level -- hiring is still required --
    // just no longer enough to make the wait for that hire itself lethal.
    arrivalBaseSp: 0.42,
  },
  {
    key: 'seed',
    name: 'SEED',
    goalMrr: 90_000,
    fundingCash: 150_000,
    salaryMult: 1.0,
    points: [4, 11],
    revenuePerPoint: [112, 180],
    baseChurn: 0.032,
    arrivalSp: { feature: 0.42, bug: 0.2, tech_debt: 0.12 },
    candidateRate: 0.12,
    severityWeights: { low: 3, medium: 4, high: 3, critical: 1 },
    trafficDailyGrowth: 0.007,
    trafficSpikeChance: 0.012,
    trafficSpikeMult: [1.3, 2.0],
    arrivalTeamMultiplier: 1.3,
    arrivalBaseSp: 0.85,
  },
  {
    key: 'series_a',
    name: 'SERIES A',
    goalMrr: 380_000,
    fundingCash: 560_000,
    salaryMult: 1.05,
    points: [5, 14],
    revenuePerPoint: [196, 306],
    baseChurn: 0.068,
    arrivalSp: { feature: 0.46, bug: 0.2, tech_debt: 0.12 },
    candidateRate: 0.13,
    severityWeights: { low: 2, medium: 4, high: 3.5, critical: 1.6 },
    trafficDailyGrowth: 0.0062,
    trafficSpikeChance: 0.013,
    trafficSpikeMult: [1.4, 2.2],
    arrivalTeamMultiplier: 1.5,
    arrivalBaseSp: 0.6,
  },
  {
    key: 'ipo',
    name: 'IPO',
    goalMrr: 480_000,
    fundingCash: 2_800_000,
    // Lowered from 1.35 and 1.9: the harness showed IPO killing well-staffed
    // teams (median 8-10 developers, some as large as 17) outright on burn,
    // not on mismanagement -- a stage that's supposed to be "a genuine wall"
    // for growth, not one a healthy team can't afford to be alive in.
    salaryMult: 1.25,
    points: [6, 17],
    revenuePerPoint: [357, 552],
    baseChurn: 0.038,
    arrivalSp: { feature: 0.5, bug: 0.23, tech_debt: 0.14 },
    candidateRate: 0.13,
    severityWeights: { low: 1.5, medium: 3.5, high: 4, critical: 2.2 },
    trafficDailyGrowth: 0.0068,
    trafficSpikeChance: 0.014,
    trafficSpikeMult: [1.4, 2.5],
    arrivalTeamMultiplier: 1.7,
    arrivalBaseSp: 0.7,
  },
];

// ─── Global constants ────────────────────────────────────────────────────────

export const SIM = {
  /** Days in a financial month. Cash and MRR are applied per Day at 1/30th. */
  daysPerMonth: 30,

  /** Base salary by Level, in Stage-1 dollars per month. */
  baseSalary: { junior: 4_200, mid: 6_200, senior: 8_600, staff: 11_500 } as Record<Level, number>,

  /** Story points per Day at Proficiency 100 and Morale 100, before Drag. */
  /**
   * Senior is raised from its original 2.9: Staff is now genuinely rare
   * (Promotable threshold 98, plus Market Pull), so Senior -- not Staff -- is
   * the realistic ceiling most of the team reaches. Every Stage's difficulty
   * was tuned assuming aggregate velocity that used to include frequent Staff
   * promotions; Senior needs to close most of that gap on its own now.
   */
  baseVelocity: { junior: 1.4, mid: 2.1, senior: 3.6, staff: 4.2 } as Record<Level, number>,

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
   *
   * Raised from 0.45: a small early team that's genuinely too busy to ever go
   * idle (arrivalBaseSp deliberately outpaces a solo/duo founder, see below)
   * got none of moraleIdleRecovery's cushion either, so a run of ordinary bad
   * luck -- a couple of high-severity tickets in a row -- had nothing to pull
   * Morale back before Notice, no matter how well the backlog was triaged.
   * The balance harness caught this as a silent, slow-bleed failure mode:
   * Garage deaths clustering around day 400+, long after the run had visibly
   * stopped growing but well before the player could tell it was doomed.
   */
  moraleBaselineRecovery: 0.6,
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

  /** Severity nudges Ticket size within the Stage band. */
  severitySize: { low: 0.8, medium: 1.0, high: 1.2, critical: 1.45 } as Record<Severity, number>,

  /** Days a Ticket must sit open before its first Escalation; halves each step. */
  escalationFirstDays: 30,
  /** Escalation weight added to Churn/Drag per level past what Severity already covers. */
  escalationPastCriticalWeight: 0.22,

  /** A Feature this old is withdrawn if still untouched. Wider band for low-severity work. */
  featureExpiryDays: { low: [85, 130], medium: [65, 105], high: [50, 85], critical: [38, 65] } as Record<Severity, [number, number]>,

  /**
   * Proficiency (in the top Discipline) needed to become Promotable to the next
   * Level. senior->staff is deliberately a much bigger jump than the others --
   * Staff is meant to be rare, not something a Series A team backs into by
   * everyone just shipping long enough.
   */
  promotionThreshold: { junior: 55, mid: 75, senior: 98, staff: Infinity } as Record<Level, number>,
  /** Morale gained on promotion -- real, but not a full reset. */
  promotionMoraleBoost: 15,

  /**
   * Target Mix: the share of the team each Level is meant to hold. Promotion
   * is never blocked by it (see Market Pull below) -- it's the reference point
   * Market Pull measures overage against.
   */
  levelTarget: { junior: 0.30, mid: 0.40, senior: 0.22, staff: 0.08 } as Record<Level, number>,

  /**
   * Market Pull (CONTEXT.md): a standing per-Day chance a Senior or Staff
   * Developer gives Notice, independent of Morale. `baseline` applies even
   * exactly at the Target Mix; `overageWeight` scales with how far that Level
   * exceeds it. Junior and Mid have no Market Pull -- their churn stays purely
   * Morale-driven.
   */
  marketPullBaseline: { junior: 0, mid: 0, senior: 0.004, staff: 0.008 } as Record<Level, number>,
  marketPullOverageWeight: 0.06,

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
    /** Headroom Managed autoscaling targets, so it doesn't sit exactly at 100% and flicker. */
    autoscaleMargin: 1.15,
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
    // Higher than Postgres/Mongo's 1.0 -- the premium isn't just the query
    // engine, it's that the player never gets to under-provision to save
    // money (see autoscaleMargin below). Paying for exactly what you need,
    // always, costs more than the chance to skimp.
    costMultiplier: 1.55,
    description: 'A fully managed cloud database -- replicas autoscale on their own. Excellent at scale, and it costs like it.',
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

/**
 * Workplace (ADR-0006). Office and Remote are genuinely different systems, not
 * one dial with two labels: a City is a single current choice with a headcount
 * cap; Countries can be unlocked in parallel, trading a wider pool for
 * Coordination Drag. "In-person decreases salary expectations, Remote
 * increases them" is the category-level rule -- individual locations still
 * vary around that, so a cheap remote country can beat an expensive city.
 */
export interface CitySpec {
  label: string;
  description: string;
  /** Flat monthly rent, independent of headcount. */
  rentBase: number;
  /** Additional monthly rent per seat of officeSize. */
  rentPerSeat: number;
  salaryMultiplier: number;
  /** Extra Candidates per Roll this City's pool tends to produce. */
  poolBonus: number;
}

export interface CountrySpec {
  label: string;
  description: string;
  /** One-time cost to unlock. The first Country a Remote company has is free. */
  unlockCost: number;
  salaryMultiplier: number;
  poolBonus: number;
}

export const OFFICE_CITIES: Record<string, CitySpec> = {
  fernhaven: {
    label: 'Fernhaven',
    description: 'A quiet second-tier city. Cheap rent, thinner talent pool.',
    rentBase: 1_800,
    rentPerSeat: 180,
    salaryMultiplier: 0.85,
    poolBonus: 0,
  },
  rivergate: {
    label: 'Rivergate',
    description: 'A mid-size tech hub. Balanced on every axis.',
    rentBase: 4_000,
    rentPerSeat: 280,
    salaryMultiplier: 1.0,
    poolBonus: 1,
  },
  meridian: {
    label: 'Meridian',
    description: 'The expensive capital. Deep bench, deep rent.',
    rentBase: 9_000,
    rentPerSeat: 420,
    salaryMultiplier: 1.15,
    poolBonus: 2,
  },
};

export const REMOTE_COUNTRIES: Record<string, CountrySpec> = {
  kestria: {
    label: 'Kestria',
    description: "Wherever the founding team already was. Always available, no unlock cost.",
    unlockCost: 0,
    salaryMultiplier: 1.05,
    poolBonus: 0,
  },
  oakmere: {
    label: 'Oakmere',
    description: 'A large, well-established remote-hiring market.',
    unlockCost: 15_000,
    salaryMultiplier: 1.15,
    poolBonus: 1,
  },
  solvane: {
    label: 'Solvane',
    description: 'Strong senior talent, priced accordingly.',
    unlockCost: 35_000,
    salaryMultiplier: 1.30,
    poolBonus: 1,
  },
  tanvir: {
    label: 'Tanvir',
    description: 'A hot, competitive market. Excellent people, top-dollar expectations.',
    unlockCost: 60_000,
    salaryMultiplier: 1.45,
    poolBonus: 2,
  },
};

export const WORKPLACE = {
  /** Default Office capacity granted the moment In-person is chosen. */
  startingOfficeSize: 4,
  /** Cost and headcount added per /office expand step. */
  officeExpandSeats: 3,
  officeExpandCostPerSeat: 2_200,

  /** Coordination Drag (CONTEXT.md): scales with how many Countries have an active hire. */
  coordinationDragWeight: 0.09,
  minCoordinationDrag: 0.55,

  /** Relocating the Office to a different City -- cheaper than a full Work Mode switch. */
  relocate: {
    costBase: 6_000,
    costMonthsOfRent: 4,
    days: [5, 8] as [number, number],
    velocityPenalty: 0.75,
  },

  /**
   * Switching Work Mode entirely. Unlike a relocation, this also costs some
   * current staff outright -- real people don't want to be told their fully
   * remote job just became an office job, or the reverse. Non-retainable:
   * this isn't a Notice, it's an immediate departure roll per Developer.
   */
  modeSwitch: {
    costBase: 20_000,
    costPerDeveloper: 4_000,
    days: [7, 11] as [number, number],
    velocityPenalty: 0.5,
    /** Chance any given current Developer leaves immediately when the switch completes. */
    staffLossChance: 0.22,
  },
} as const;
