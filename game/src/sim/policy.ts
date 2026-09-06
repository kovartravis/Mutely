/**
 * A reference player, used by the balance harness to stand in for a competent
 * human. It is deliberately good-but-not-optimal: it triages sensibly, hires
 * when it can afford to, and defends morale -- roughly what an attentive player
 * does. Win rates are measured against this, not against perfect play.
 */

import { apply } from './commands';
import {
  computeCost, computeEfficiency, dbCapacity, dbEfficiency, finances,
  isOpen, rawComputeCapacity, requiredCapacity,
} from './economy';
import { isPromotable } from './roll';
import { INFRA, SIM, stageAt } from './tuning';
import { RunState } from './types';

/**
 * Turns on standing auto-assign, matching what a player who types /auto once
 * gets: the tick itself keeps idle Developers on their best Ticket by Triage
 * (see tick.ts:doAutoAssign). Idempotent -- call it every turn without cost.
 */
// Step 0: enable standing auto-assign once, up front.
export function ensureAutoAssign(state: RunState): RunState {
  return state.autoAssign ? state : apply(state, '/auto').state;
}

/**
 * Infra is deliberately the least sophisticated part of the reference player:
 * scale up when running hot, scale down when running cold, migrate off
 * monolith once its superlinear cost curve makes kubernetes cheaper for the
 * same capacity. It never tries serverless -- good enough to keep infra
 * managed without it becoming the harness's real skill ceiling.
 */
function infraCommands(state: RunState): string[] {
  const commands: string[] = [];
  const infra = state.infra;
  if (infra.pending !== null) return commands; // one thing at a time

  // Every disruptive infra decision below (migrating Architecture, switching
  // Runtime, buying a Cache) is gated on being past the single-founder phase.
  // Each costs cash and days of reduced velocity -- a fine trade once there is
  // a team and revenue to protect, a self-inflicted wound when the founder
  // alone is still trying to reach the first hire.
  const established = state.developers.length >= 2 || stageAt(state.stageIndex).key !== 'garage';

  const need = requiredCapacity(state);

  // Compute and Database are independent bottlenecks (effective capacity is
  // whichever is tighter), so each is scaled toward its own target utilization
  // rather than reacting to the combined figure -- otherwise scaling compute
  // does nothing when the Database was the actual constraint.
  const uCompute = need / Math.max(rawComputeCapacity(infra) * computeEfficiency(state), 1);
  if (uCompute > 0.85) {
    const target = Math.ceil(infra.compute * (uCompute / 0.6));
    if (target > infra.compute) commands.push(`/scale compute +${target - infra.compute}`);
  } else if (uCompute < 0.25 && infra.compute > 1) {
    const target = Math.max(1, Math.floor(infra.compute * (uCompute / 0.5 || 1)));
    if (target < infra.compute) commands.push(`/scale compute -${infra.compute - target}`);
  }

  const uDb = need / Math.max(dbCapacity(infra) * dbEfficiency(state), 1);
  if (uDb > 0.85) {
    const target = Math.ceil(infra.dbReplicas * (uDb / 0.6));
    if (target > infra.dbReplicas) commands.push(`/scale db +${target - infra.dbReplicas}`);
  } else if (uDb < 0.25 && infra.dbReplicas > 1) {
    const target = Math.max(1, Math.floor(infra.dbReplicas * (uDb / 0.5 || 1)));
    if (target < infra.dbReplicas) commands.push(`/scale db -${infra.dbReplicas - target}`);
  }

  if (established && infra.architecture === 'monolith') {
    // The monolith's cost is superlinear; kubernetes wins once its overhead is
    // paid back. Compare what each would cost to serve today's traffic.
    const monolithCost = computeCost(infra);
    const nodesNeeded = Math.max(1, Math.ceil(infra.compute * (INFRA.monolith.capacityPerUnit / INFRA.kubernetes.capacityPerNode)));
    const k8sCost = INFRA.kubernetes.baseOverhead + nodesNeeded * INFRA.kubernetes.costPerNode;
    if (monolithCost > k8sCost * 1.4 && state.cash > monolithCost * 8) {
      commands.push('/migrate kubernetes');
      commands.push('/migrate kubernetes confirm');
    }
  }

  // Runtime is the one Sub-architecture axis this reference player touches --
  // Go's capacity multiplier pays for its +1sp cost once compute is genuinely
  // the bottleneck. It leaves the Database engine at the Postgres default
  // (already a strong general choice) and never tries Managed, mirroring how
  // it never tries serverless: good enough without becoming the skill ceiling.
  if (established && infra.runtime === 'node' && Math.max(uCompute, 0) > 0.7 && state.cash > computeCost(infra) * 15) {
    commands.push('/switch runtime go');
    commands.push('/switch runtime go confirm');
  }

  // A Cache pays for itself once compute or database utilization runs hot --
  // buy it, then upgrade as the ceiling stops being enough, and refresh before
  // it goes stale enough to risk an integrity bug.
  const hot = Math.max(uCompute, uDb) > 0.7;
  const tiers = INFRA.cache.tiers;
  if (established && !infra.cache.active && hot && state.cash > tiers[1].monthlyCost * 15) {
    commands.push('/cache buy');
  } else if (established && infra.cache.active && hot && infra.cache.tier < tiers.length - 1 && state.cash > tiers[infra.cache.tier + 1].monthlyCost * 15) {
    commands.push('/cache upgrade');
  }
  if (infra.cache.active && state.day - infra.cache.lastRefreshedDay > INFRA.cache.staleAfterDays - 5) {
    commands.push('/cache refresh');
  }

  return commands;
}

export function decide(state: RunState): string[] {
  const commands: string[] = [...infraCommands(state)];
  const f = finances(state);

  // 0. A Proficiency-eligible Developer is promoted immediately -- the raised
  //    base Velocity is worth its proportional salary bump almost every time.
  for (const dev of state.developers) {
    if (isPromotable(dev)) commands.push(`/promote @${dev.handle}`);
  }

  // 1. Defend Morale before it becomes Notice. A one-off bonus is preferred to a
  //    raise: a raise is permanent burn, and burn is what actually kills runs.
  for (const dev of state.developers) {
    const urgent = dev.noticeDaysLeft !== null;
    if (!urgent && dev.morale > 45) continue;

    const target = urgent ? SIM.retentionMoraleFloor + 5 : 70;
    const needed = Math.max(0, target - dev.morale);
    if (needed <= 0) continue;

    const bonus = Math.ceil((needed / SIM.moralePerBonusK) * 1000);
    if (f.cash > bonus * 4) {
      commands.push(`/bonus @${dev.handle} ${bonus}`);
    } else if (urgent) {
      // Cannot afford to buy them back outright; a modest raise is the last resort.
      const raise = Math.min(Math.ceil((needed / SIM.moralePerRaiseK) * 1000), dev.salary * 0.2);
      if (raise > 0 && f.cash > raise * 12) commands.push(`/raise @${dev.handle} ${Math.round(raise)}`);
    }
  }

  // 2. An empty team ships nothing -- hire at any price that leaves cash.
  if (state.developers.length === 0 && state.candidates.length > 0) {
    const cheapest = [...state.candidates].sort((a, b) => a.salary - b.salary)[0];
    if (f.cash > cheapest.salary * (SIM.hiringFeeMonths + 2)) {
      return [...commands, `/hire @${cheapest.handle}`];
    }
  }

  // Idle-Developer assignment is handled by standing auto-assign in the tick
  // (ensureAutoAssign, step 0 above), not issued as a command here.
  const open = state.tickets.filter((t) => isOpen(t) && t.status !== 'in_progress');

  // 3. Hire when there is work spare and the runway can absorb the salary.
  // Steady-state MRR is R/c, and R scales with headcount -- so while the Stage
  // goal is still ahead, growing the team is the only way to raise the ceiling.
  // Waiting for a backlog to pile up first just plateaus below the goal.
  // A hire is almost always NPV-positive at equilibrium, but equilibrium is ~1/c
  // months away and salary is due immediately -- so unbounded hiring is correct
  // long-run and fatal short-run. Real players hire at a cadence; so does this.
  const RECENT_HIRE_DAYS = 15;
  const hiredRecently = state.developers.some((d) => state.day - d.joinedDay < RECENT_HIRE_DAYS);
  const chasingGoal = state.mrr < stageAt(state.stageIndex).goalMrr * 1.1;
  const worthGrowing = chasingGoal || open.length > state.developers.length * 1.5;
  // A team of one is a single point of failure for the whole company -- the
  // second hire is worth taking on much thinner justification than the tenth,
  // both in reality and here: without it, a solo founder can never clear a
  // growing backlog, and unaddressed Tech Debt compounding into ever-more-
  // expensive required Capacity is a death spiral no amount of infra
  // management alone can fix.
  const runwayBar = state.developers.length <= 1 ? 6 : 15;
  if (worthGrowing && !hiredRecently && state.candidates.length > 0) {
    const affordable = state.candidates
      .filter((c) => {
        const fee = c.salary * SIM.hiringFeeMonths;
        const newBurn = f.burn + c.salary;
        const newRunway = f.cash - fee > 0 ? (f.cash - fee) / Math.max(newBurn - state.mrr, 1) : 0;
        return f.cash > fee * 3 && newRunway > runwayBar;
      })
      .sort((a, b) => {
        const va = SIM.baseVelocity[a.level] / a.salary;
        const vb = SIM.baseVelocity[b.level] / b.salary;
        return vb - va;
      });
    if (affordable[0]) commands.push(`/hire @${affordable[0].handle}`);
  }

  return commands;
}

export function playTurn(state: RunState): RunState {
  let s = ensureAutoAssign(state);
  for (const command of decide(s)) s = apply(s, command).state;
  return s;
}
