/**
 * Derived economic state. Single source of truth -- the old code recalculated
 * finances in five separate handlers and they had already drifted apart.
 */

import { DB_ENGINE_SPECS, INFRA, RUNTIME_SPECS, SIM, stageAt } from './tuning';
import { Developer, Finances, Infra, RunState, Severity, Ticket } from './types';

export const isOpen = (t: Ticket) => t.status !== 'done';

const SEVERITY_ORDER: Severity[] = ['low', 'medium', 'high', 'critical'];

/**
 * A Ticket's real-world severity right now: its rolled Severity ratcheted up
 * by Escalation, capped at critical. `t.severity` itself is never mutated --
 * it stays the value rolled at creation, and this is the derived, current
 * reading everywhere weight or display needs "how bad is this, today."
 */
export function effectiveSeverity(t: Ticket): Severity {
  const idx = Math.min(3, SEVERITY_ORDER.indexOf(t.severity) + Math.min(t.escalationLevel, 3));
  return SEVERITY_ORDER[idx];
}

/** How much open Tech Debt inflates the Capacity required for current Traffic. */
export function debtInflation(state: RunState): number {
  const weight = state.tickets
    .filter((t) => t.type === 'tech_debt' && isOpen(t))
    .reduce((sum, t) => sum + INFRA.debtInfraWeight[effectiveSeverity(t)] + escalationWeight(t), 0);
  return Math.min(1 + weight, INFRA.maxDebtInflation);
}

/** One open Tech Debt Ticket's own share of the capacity inflation above -- for pricing it (triage.ts). */
export function debtInflationWeight(t: Ticket): number {
  return INFRA.debtInfraWeight[effectiveSeverity(t)] + escalationWeight(t);
}

/** Weight added by a Ticket's Escalation past what its Severity already covers (ADR: Escalation). */
export function escalationWeight(t: Ticket): number {
  return Math.max(0, t.escalationLevel - 3) * SIM.escalationPastCriticalWeight;
}

/** A team's average Proficiency in one Discipline, 0 when nobody is hired yet. */
function teamProficiency(state: RunState, discipline: 'devops' | 'dba'): number {
  if (state.developers.length === 0) return 0;
  const total = state.developers.reduce((sum, d) => sum + d.proficiency[discipline], 0);
  return total / state.developers.length;
}

const efficiencyFor = (proficiency: number) =>
  INFRA.efficiencyAtZero + (INFRA.efficiencyAtMax - INFRA.efficiencyAtZero) * (proficiency / 100);

/** Compute Efficiency, from the team's average devops Proficiency. */
export function computeEfficiency(state: RunState): number {
  return efficiencyFor(teamProficiency(state, 'devops'));
}

/** Database Efficiency, from the team's average dba Proficiency. */
export function dbEfficiency(state: RunState): number {
  return efficiencyFor(teamProficiency(state, 'dba'));
}

/** Raw compute capacity (req/day) before Efficiency, per the Architecture's own shape. */
export function rawComputeCapacity(infra: Infra): number {
  const runtime = RUNTIME_SPECS[infra.runtime].capacityMultiplier;
  switch (infra.architecture) {
    case 'monolith':
      return infra.compute * INFRA.monolith.capacityPerUnit * runtime;
    case 'kubernetes':
      return infra.compute * INFRA.kubernetes.capacityPerNode * runtime;
    case 'serverless':
      return infra.compute * INFRA.serverless.capacityPerConcurrencyUnit * runtime;
  }
}

/** Monthly $ cost of the compute dial alone, per the Architecture's own shape. */
export function computeCost(infra: Infra): number {
  const runtime = RUNTIME_SPECS[infra.runtime].costMultiplier;
  switch (infra.architecture) {
    case 'monolith': {
      const { costBase, costExponent } = INFRA.monolith;
      return costBase * Math.pow(infra.compute, costExponent) * runtime;
    }
    case 'kubernetes': {
      const { baseOverhead, costPerNode } = INFRA.kubernetes;
      return (baseOverhead + costPerNode * infra.compute) * runtime;
    }
    case 'serverless': {
      const { costPerConcurrencyUnit, costPerMillionRequests } = INFRA.serverless;
      const monthlyRequests = (infra.traffic * SIM.daysPerMonth) / 1_000_000;
      return (costPerConcurrencyUnit * infra.compute + costPerMillionRequests * monthlyRequests) * runtime;
    }
  }
}

export function dbCapacity(infra: Infra): number {
  const engine = DB_ENGINE_SPECS[infra.dbEngine];
  return infra.dbReplicas * INFRA.db.capacityPerReplica * engine.capacityMultiplier;
}

export function dbCost(infra: Infra): number {
  const engine = DB_ENGINE_SPECS[infra.dbEngine];
  return infra.dbReplicas * INFRA.db.costPerReplica * engine.costMultiplier;
}

/** Monthly $ cost of the Cache, 0 when not active. */
export function cacheCost(infra: Infra): number {
  return infra.cache.active ? INFRA.cache.tiers[infra.cache.tier].monthlyCost : 0;
}

/** Monthly $ cost of the whole infra bill: compute + database + cache. */
export function infraCost(state: RunState): number {
  return computeCost(state.infra) + dbCost(state.infra) + cacheCost(state.infra);
}

/**
 * Traffic the current infrastructure can actually serve, after Efficiency.
 * Compute and Database are separate resources -- whichever is tighter wins.
 */
export function effectiveCapacity(state: RunState): number {
  const compute = rawComputeCapacity(state.infra) * computeEfficiency(state);
  const db = dbCapacity(state.infra) * dbEfficiency(state);
  return Math.min(compute, db);
}

/**
 * Traffic the infrastructure needs to serve, after Tech Debt inflation and the
 * Cache absorbing its hit rate before anything reaches Compute or the Database.
 */
export function requiredCapacity(state: RunState): number {
  const served = state.infra.traffic * debtInflation(state);
  const cache = state.infra.cache;
  return cache.active ? served * (1 - cache.hitRate) : served;
}

/** >1 means Over Capacity (ADR-0004: raises Churn the same way a Bug does). */
export function utilization(state: RunState): number {
  const capacity = effectiveCapacity(state);
  return capacity > 0 ? requiredCapacity(state) / capacity : Infinity;
}

/** PRESSURE 1a: open bugs multiply the Stage's base churn. Escalation compounds it further. */
function bugChurnWeight(state: RunState): number {
  return state.tickets
    .filter((t) => t.type === 'bug' && isOpen(t))
    .reduce((sum, t) => sum + SIM.bugChurnWeight[effectiveSeverity(t)] + escalationWeight(t), 0);
}

/** PRESSURE 1b: running Over Capacity multiplies churn the same way a bug does. */
function overCapacityChurnWeight(state: RunState): number {
  const over = utilization(state) - 1;
  return over > 0 ? over * INFRA.overCapacityChurnPerUnit : 0;
}

/** PRESSURE 1: bugs and Over Capacity both multiply the Stage's base churn. */
export function churnRate(state: RunState): number {
  const weight = bugChurnWeight(state) + overCapacityChurnWeight(state);
  const multiplier = Math.min(1 + weight, SIM.maxChurnMultiplier);
  return stageAt(state.stageIndex).baseChurn * multiplier;
}

/** PRESSURE 2: open tech debt drags the whole team's Velocity. */
export function drag(state: RunState): number {
  const weight = state.tickets
    .filter((t) => t.type === 'tech_debt' && isOpen(t))
    .reduce((sum, t) => sum + SIM.debtDragWeight[t.severity], 0);
  return Math.max(1 / (1 + weight), SIM.minDrag);
}

/** A pending infra change distracts the whole team, applied the same shape as Drag (ADR-0005). */
export function migrationPenalty(state: RunState): number {
  const pending = state.infra.pending;
  if (!pending) return 1;
  return pending.kind === 'architecture' ? INFRA.migration.velocityPenalty : INFRA.subSwitch.velocityPenalty;
}

/** Combined multiplier for anywhere Velocity is computed: Drag and Migration together. */
export function velocityMultiplier(state: RunState): number {
  return drag(state) * migrationPenalty(state);
}

/** PRESSURE 3: salaries and infrastructure spend both burn Cash. */
export function burn(state: RunState): number {
  const salaries = state.developers.reduce((sum, d) => sum + d.salary, 0);
  return salaries + infraCost(state);
}

export function runway(cash: number, monthlyBurn: number, mrr: number): number {
  const net = monthlyBurn - mrr;
  if (net <= 0) return Infinity;
  return cash / net;
}

export function finances(state: RunState): Finances {
  const monthlyBurn = burn(state);
  return {
    cash: state.cash,
    mrr: state.mrr,
    burn: monthlyBurn,
    churnRate: churnRate(state),
    drag: drag(state),
    runway: runway(state.cash, monthlyBurn, state.mrr),
  };
}

/** How much Proficiency the Developer brings to this Ticket's Discipline. */
export function proficiencyFactor(dev: Developer, ticket: Ticket): number {
  const p = dev.proficiency[ticket.discipline] / 100;
  return SIM.proficiencyFloor + (1 - SIM.proficiencyFloor) * p;
}

/**
 * Story points this Developer completes today on this Ticket.
 * No floor -- a Developer at zero Morale genuinely stops producing.
 */
export function effectiveVelocity(dev: Developer, ticket: Ticket, dragMultiplier: number): number {
  return (
    SIM.baseVelocity[dev.level] *
    proficiencyFactor(dev, ticket) *
    (dev.morale / 100) *
    dragMultiplier
  );
}

/** Whole days until this Ticket ships at today's rate, or null if it never will. */
export function daysRemaining(dev: Developer, ticket: Ticket, dragMultiplier: number): number | null {
  const v = effectiveVelocity(dev, ticket, dragMultiplier);
  if (v <= 0.01) return null;
  return Math.ceil((ticket.storyPoints - ticket.progressPoints) / v);
}
