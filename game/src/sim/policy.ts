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
import { isPromotable, nextLevel } from './roll';
import { INFRA, REMOTE_COUNTRIES, SIM, stageAt, WORKPLACE } from './tuning';
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

  // Managed replicas autoscale on their own (tick.ts:doManagedDbAutoscale) --
  // issuing /scale db against it would just be refused.
  const uDb = need / Math.max(dbCapacity(infra) * dbEfficiency(state), 1);
  if (infra.dbEngine !== 'managed') {
    if (uDb > 0.85) {
      const target = Math.ceil(infra.dbReplicas * (uDb / 0.6));
      if (target > infra.dbReplicas) commands.push(`/scale db +${target - infra.dbReplicas}`);
    } else if (uDb < 0.25 && infra.dbReplicas > 1) {
      const target = Math.max(1, Math.floor(infra.dbReplicas * (uDb / 0.5 || 1)));
      if (target < infra.dbReplicas) commands.push(`/scale db -${infra.dbReplicas - target}`);
    }
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

/**
 * Reactive Office/Remote upkeep, mirroring infraCommands: expand the Office
 * before it blocks hiring outright, or unlock the next Country once cash is
 * comfortable. Never touches which Work Mode was chosen -- that's a one-time
 * decision made in decide() below, the moment Seed opens.
 */
function workplaceCommands(state: RunState): string[] {
  const wp = state.workplace;
  const commands: string[] = [];
  if (wp.mode === null || wp.pending) return commands; // one thing at a time

  if (wp.mode === 'inperson') {
    // Expand a step before the cap actually bites, not after -- a full Office
    // blocks hiring outright, and by then a candidate may already be lost.
    if (state.developers.length >= wp.officeSize - 1) {
      const cost = WORKPLACE.officeExpandSeats * WORKPLACE.officeExpandCostPerSeat;
      if (state.cash > cost * 4) commands.push('/office expand');
    }
  } else {
    // Unlock the next cheapest Country once cash is comfortable -- grows the
    // candidate pool at the cost of Coordination Drag, so this isn't free
    // upside; it's a real trade the reference player makes deliberately.
    const locked = Object.entries(REMOTE_COUNTRIES)
      .filter(([key]) => !wp.unlockedCountries.includes(key))
      .sort((a, b) => a[1].unlockCost - b[1].unlockCost);
    if (locked[0] && state.cash > locked[0][1].unlockCost * 6) {
      commands.push(`/remote unlock ${locked[0][0]}`);
    }
  }

  return commands;
}

export function decide(state: RunState): string[] {
  // ADR-0006: the game will not let the clock advance again until a Work Mode
  // is chosen, so the harness must decide promptly or stall forever. Which
  // mode is "better" isn't the point of this reference player -- deciding at
  // all, immediately, is: In-person plus the cheapest City keeps the rest of
  // its economics simple and predictable.
  if (state.stageIndex >= 1 && state.workplace.mode === null) {
    return ['/workmode inperson fernhaven'];
  }

  const commands: string[] = [...infraCommands(state), ...workplaceCommands(state)];
  const f = finances(state);

  // 0. A Proficiency-eligible Developer is promoted -- but staggered, not
  //    blindly maxed out. Promoting into Senior/Staff once that Level is
  //    already well past its Target Mix just buys immediate Market Pull; a
  //    careful player holds a ready promotion back rather than stack the team
  //    top-heavy on purpose.
  for (const dev of state.developers) {
    if (!isPromotable(dev)) continue;
    const next = nextLevel(dev.level);
    if (next === 'senior' || next === 'staff') {
      const projectedCount = state.developers.filter((d) => d.level === next).length + 1;
      const projectedShare = projectedCount / state.developers.length;
      if (projectedShare > SIM.levelTarget[next] * 1.3) continue;
    }
    commands.push(`/promote @${dev.handle}`);
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
      // Cannot afford to buy them back outright with a bonus. A raise is the
      // last resort, but it's a *permanent* burn increase -- if a raise
      // yesterday didn't already clear the notice, retrying it daily while
      // notice ticks down compounds (each capped at 20% of an already-raised
      // salary) into runaway burn without ever fixing the actual problem.
      // Cap how far above their Level's base band a retention raise will go;
      // past that, losing them is cheaper than continuing to overpay.
      const ceiling = SIM.baseSalary[dev.level] * stageAt(state.stageIndex).salaryMult * 1.6;
      if (dev.salary < ceiling) {
        const raise = Math.min(Math.ceil((needed / SIM.moralePerRaiseK) * 1000), dev.salary * 0.2, ceiling - dev.salary);
        if (raise > 0 && f.cash > raise * 12) commands.push(`/raise @${dev.handle} ${Math.round(raise)}`);
      }
    }
  }

  // 2. An empty team ships nothing -- hire at any price that leaves cash.
  // A zero-headcount company earns nothing and fixes nothing every day it
  // waits, so the bar here is just the recruiter fee itself, not a runway
  // cushion -- waiting for a bigger buffer while burning down with no one
  // working is strictly worse than hiring the moment it's affordable at all.
  if (state.developers.length === 0 && state.candidates.length > 0) {
    const cheapest = [...state.candidates].sort((a, b) => a.salary - b.salary)[0];
    if (f.cash > cheapest.salary * SIM.hiringFeeMonths) {
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
  // A solo founder used to reach Staff (and its velocity boost) within a
  // couple hundred days, which is what actually cleared this bar quickly.
  // Staff is deliberately much harder to reach now (CONTEXT.md: Promotable),
  // so a founder stuck at Mid-level velocity for far longer needs a thinner
  // bar to ever cross it -- this isn't a weaker check, it's removing a
  // dependency on a crutch that no longer exists.
  const runwayBar = state.developers.length <= 1 ? 5 : 15;
  if (worthGrowing && !hiredRecently && state.candidates.length > 0) {
    const affordable = state.candidates
      .filter((c) => {
        const fee = c.salary * SIM.hiringFeeMonths;
        const newBurn = f.burn + c.salary;
        const newRunway = f.cash - fee > 0 ? (f.cash - fee) / Math.max(newBurn - state.mrr, 1) : 0;
        return f.cash > fee * 3 && newRunway > runwayBar;
      })
      .sort((a, b) => {
        // While the team is still tiny, cash is the scarce resource, not
        // throughput efficiency -- bootstrap on whoever is cheapest rather
        // than reaching for a senior/staff candidate's better velocity/dollar
        // and straining runway on the very first hires. Once established,
        // optimize for value per dollar like a team with room to spend would.
        if (state.developers.length < 3) return a.salary - b.salary;
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
