/**
 * The serialisable shape of a Run. Everything the simulation needs lives here,
 * so a save is JSON.stringify(RunState) and nothing else.
 */

import { RngState } from './rng';

// ─── Work ────────────────────────────────────────────────────────────────────

export const DISCIPLINES = ['frontend', 'backend', 'devops', 'ml', 'dba'] as const;
export type Discipline = (typeof DISCIPLINES)[number];

export const LEVELS = ['junior', 'mid', 'senior', 'staff'] as const;
export type Level = (typeof LEVELS)[number];

export type TicketType = 'feature' | 'bug' | 'tech_debt';
export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type TicketStatus = 'backlog' | 'in_progress' | 'done';

/** Proficiency 0-100 in each Discipline. */
export type ProficiencyMap = Record<Discipline, number>;

// ─── People ──────────────────────────────────────────────────────────────────

export interface Developer {
  id: string;
  /** Player-facing Handle, e.g. "marcus". Rendered as "@marcus". */
  handle: string;
  name: string;
  level: Level;
  proficiency: ProficiencyMap;
  /** Monthly salary. */
  salary: number;
  morale: number;
  currentTicketId: string | null;
  /** Days of Notice remaining, or null when not resigning. */
  noticeDaysLeft: number | null;
  /** Day they joined, for tenure display. */
  joinedDay: number;
}

export interface Candidate {
  id: string;
  handle: string;
  name: string;
  level: Level;
  proficiency: ProficiencyMap;
  salary: number;
  blurb: string;
  /** Day the candidate withdraws if not hired. */
  expiresDay: number;
}

// ─── Tickets ─────────────────────────────────────────────────────────────────

export interface Ticket {
  id: string;
  /** Player-facing Handle, e.g. "a3". Rendered as "#a3". */
  handle: string;
  title: string;
  description: string;
  type: TicketType;
  severity: Severity;
  discipline: Discipline;
  storyPoints: number;
  progressPoints: number;
  /** Monthly MRR added on completion. Features only. */
  revenue: number;
  status: TicketStatus;
  assignedTo: string | null;
  createdDay: number;
  completedDay: number | null;
  /**
   * How many times this Ticket has escalated. Bugs and Tech Debt only. 0..3
   * ratchets Severity low->medium->high->critical; beyond that it keeps
   * counting and further inflates Churn/Drag without a Severity label change.
   */
  escalationLevel: number;
  /** Features only: the Day this Ticket is withdrawn if still open. */
  expiresDay: number | null;
}

// ─── Events ──────────────────────────────────────────────────────────────────

export type EventLevel = 'info' | 'good' | 'warn' | 'alarm' | 'command' | 'reply';

export interface GameEvent {
  id: string;
  day: number;
  level: EventLevel;
  text: string;
}

// ─── Flavor ──────────────────────────────────────────────────────────────────

export interface FlavorItem {
  title: string;
  description: string;
}

export interface PersonFlavor {
  name: string;
  blurb: string;
}

/** Bucketed buffer of unused Flavor. Popped synchronously when the sim Rolls. */
export interface FlavorQueue {
  /** Keyed "type:discipline", e.g. "bug:backend". */
  tickets: Record<string, FlavorItem[]>;
  people: PersonFlavor[];
  /** Titles already used this Run, so Flavor is never repeated. */
  usedTitles: string[];
  /** True when the last refill attempt failed. */
  offline: boolean;
}

// ─── Infrastructure ──────────────────────────────────────────────────────────

export const ARCHITECTURES = ['monolith', 'kubernetes', 'serverless'] as const;
export type Architecture = (typeof ARCHITECTURES)[number];

export const DB_ENGINES = ['postgres', 'mongo', 'managed'] as const;
export type DbEngine = (typeof DB_ENGINES)[number];

export const RUNTIMES = ['node', 'go', 'python'] as const;
export type Runtime = (typeof RUNTIMES)[number];

/** One in-flight change of any kind (ADR-0005). Only one at a time, across all three axes. */
export interface PendingChange {
  kind: 'architecture' | 'db' | 'compute';
  target: Architecture | DbEngine | Runtime;
  daysLeft: number;
}

export interface Cache {
  active: boolean;
  /** 1, 2, or 3. Sets the ceiling `hitRate` decays toward when refreshed. */
  tier: number;
  /** 0..1 fraction of Traffic served without touching Compute or Database. */
  hitRate: number;
  lastRefreshedDay: number;
}

export interface Infra {
  architecture: Architecture;
  dbEngine: DbEngine;
  runtime: Runtime;
  /**
   * The architecture-specific compute dial: server Tier for monolith, Node
   * count for kubernetes, reserved Concurrency (thousands) for serverless.
   * Always >= 1 -- a company never runs on zero infrastructure.
   */
  compute: number;
  /** Database replicas. Shared across all three Architectures. Always >= 1. */
  dbReplicas: number;
  /** Simulated requests/day the product must serve today (baseline, plus a spike if one hit). */
  traffic: number;
  /**
   * The underlying trend Traffic compounds from. A spike multiplies `traffic`
   * for one Day only and never touches this, so spikes decay back to trend
   * instead of ratcheting the baseline upward forever.
   */
  trafficBaseline: number;
  cache: Cache;
  pending: PendingChange | null;
}

// ─── Run ─────────────────────────────────────────────────────────────────────

export type RunStatus = 'running' | 'paused' | 'won' | 'lost';

export interface Finances {
  cash: number;
  mrr: number;
  /** Monthly salary total. */
  burn: number;
  /** Effective monthly churn rate, after bug multipliers. 0.028 = 2.8%/mo. */
  churnRate: number;
  /** Team-wide Velocity multiplier from unresolved Tech Debt. 1.0 = no Drag. */
  drag: number;
  /** Months of cash left. Infinity when cash-flow positive. */
  runway: number;
}

export interface RunState {
  version: number;
  companyName: string;
  rng: RngState;

  day: number;
  stageIndex: number;
  status: RunStatus;
  /** Days per real second multiplier: 0 = paused, 1, 2, 4. */
  speed: number;
  /** When on, the Day tick puts idle Developers on their best Ticket by Triage. */
  autoAssign: boolean;

  infra: Infra;

  cash: number;
  mrr: number;

  developers: Developer[];
  candidates: Candidate[];
  tickets: Ticket[];
  events: GameEvent[];

  flavor: FlavorQueue;

  /** Monotonic counters so Handles never collide, even after deletions. */
  handleSeq: number;
  idSeq: number;
}
