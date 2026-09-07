/**
 * One Day of simulation. Pure: tick(state) -> state.
 *
 * Order matters. Work resolves before Churn so a Ticket shipped today earns from
 * today, and Bankruptcy is checked last and every Day -- the old code only looked
 * every 30 Days, so a company could be insolvent for a month without noticing.
 */

import {
  burn, churnRate, computeEfficiency, dbEfficiency, effectiveSeverity, effectiveVelocity,
  levelShare, marketPullChance, requiredCapacity, utilization, velocityMultiplier, workplacePoolBonus,
} from './economy';
import { createRng, Rng } from './rng';
import { rollCandidate, rollTicket } from './roll';
import {
  DB_ENGINE_SPECS, expectedTicketPoints, INFRA, OFFICE_CITIES, RUNTIME_SPECS, SIM, stageAt, STAGES, WORKPLACE,
} from './tuning';
import { idleDevelopers, planAssignments } from './triage';
import {
  Architecture, DbEngine, Developer, EventLevel, GameEvent, Runtime, RunState, Ticket, TicketType, WorkMode,
} from './types';

const MAX_EVENTS = 400;
/**
 * Completed Tickets are kept only for the recent-history panels. Nothing derives
 * from them -- MRR is a stock and Proficiency is applied on completion -- so the
 * tail is pruned to stop the array (and every per-Day copy of it) growing without
 * bound over a long Run.
 */
const MAX_DONE_TICKETS = 60;

function draft(state: RunState): RunState {
  return {
    ...state,
    developers: state.developers.map((d) => ({ ...d })),
    candidates: state.candidates.map((c) => ({ ...c })),
    tickets: state.tickets.map((t) => ({ ...t })),
    events: state.events.slice(),
    flavor: {
      tickets: Object.fromEntries(
        Object.entries(state.flavor.tickets).map(([k, v]) => [k, v.slice()]),
      ),
      people: state.flavor.people.slice(),
      usedTitles: state.flavor.usedTitles.slice(),
      offline: state.flavor.offline,
    },
    infra: {
      ...state.infra,
      cache: { ...state.infra.cache },
      pending: state.infra.pending ? { ...state.infra.pending } : null,
    },
  };
}

export function pushEvent(state: RunState, level: EventLevel, text: string): void {
  const event: GameEvent = { id: `e${state.idSeq++}`, day: state.day, level, text };
  state.events.push(event);
  if (state.events.length > MAX_EVENTS) state.events.splice(0, state.events.length - MAX_EVENTS);
}

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

function releaseTicket(state: RunState, dev: Developer): void {
  if (!dev.currentTicketId) return;
  const ticket = state.tickets.find((t) => t.id === dev.currentTicketId);
  if (ticket && ticket.status === 'in_progress') {
    ticket.status = 'backlog';
    ticket.assignedTo = null;
  }
  dev.currentTicketId = null;
}

// ─── Phases ──────────────────────────────────────────────────────────────────

function doWork(state: RunState): void {
  const dragMultiplier = velocityMultiplier(state);

  for (const dev of state.developers) {
    const ticket = dev.currentTicketId
      ? state.tickets.find((t) => t.id === dev.currentTicketId)
      : undefined;

    // Idle, or pointing at a Ticket that is no longer in progress. The old code
    // left currentTicketId dangling here, so a Developer could be permanently
    // "busy" while quietly recovering Morale.
    if (!ticket || ticket.status !== 'in_progress') {
      dev.currentTicketId = null;
      dev.morale = Math.min(100, dev.morale + SIM.moraleBaselineRecovery + SIM.moraleIdleRecovery);
      continue;
    }

    const stress =
      SIM.moraleDrain[effectiveSeverity(ticket)] * (ticket.type === 'bug' ? SIM.bugMoraleMultiplier : 1);
    const before = dev.morale;
    dev.morale = Math.max(0, Math.min(100, dev.morale - stress + SIM.moraleBaselineRecovery));

    if (before >= SIM.moraleNoticeThreshold && dev.morale < SIM.moraleNoticeThreshold) {
      pushEvent(state, 'warn', `@${dev.handle} is burning out (morale ${Math.round(dev.morale)}).`);
    }

    ticket.progressPoints += effectiveVelocity(dev, ticket, dragMultiplier);

    if (ticket.progressPoints >= ticket.storyPoints) {
      ticket.progressPoints = ticket.storyPoints;
      ticket.status = 'done';
      ticket.completedDay = state.day;
      ticket.assignedTo = null;
      dev.currentTicketId = null;
      dev.morale = Math.min(
        100,
        dev.morale + SIM.moraleShipBase + SIM.moraleShipPerPoint * ticket.storyPoints,
      );

      dev.proficiency[ticket.discipline] = Math.min(
        SIM.proficiencyCap,
        dev.proficiency[ticket.discipline] + ticket.storyPoints * SIM.proficiencyGainPerPoint,
      );

      if (ticket.type === 'feature') {
        state.mrr += ticket.revenue;
        pushEvent(state, 'good', `@${dev.handle} shipped #${ticket.handle} "${ticket.title}" (+${money(ticket.revenue)}/mo)`);
      } else {
        const kind = ticket.type === 'bug' ? 'fixed' : 'cleared';
        pushEvent(state, 'good', `@${dev.handle} ${kind} #${ticket.handle} "${ticket.title}"`);
      }
    }
  }
}

function doAttrition(state: RunState, rng: Rng): void {
  for (const dev of state.developers.slice()) {
    if (dev.noticeDaysLeft !== null) {
      dev.noticeDaysLeft -= 1;
      if (dev.noticeDaysLeft <= 0) {
        releaseTicket(state, dev);
        state.developers = state.developers.filter((d) => d.id !== dev.id);
        pushEvent(state, 'alarm', `@${dev.handle} left the company.`);
      }
      continue;
    }

    if (dev.morale < SIM.moraleNoticeThreshold) {
      const pressure = (SIM.moraleNoticeThreshold - dev.morale) / SIM.moraleNoticeThreshold;
      if (rng.chance(pressure * SIM.noticeChanceAtZero)) {
        dev.noticeDaysLeft = rng.int(...SIM.noticeDays);
        pushEvent(
          state,
          'alarm',
          `@${dev.handle} gave notice -- leaving in ${dev.noticeDaysLeft} days. /raise or /bonus to retain.`,
        );
        continue; // already gave notice today; don't also roll Market Pull
      }
    }

    // Market Pull (CONTEXT.md): Senior/Staff can be recruited away regardless
    // of Morale -- the one Pressure that isn't caused by anything the player
    // did wrong. Reuses the same Notice/retention path as morale-driven churn.
    // Junior/Mid never reach this: rng.chance() always consumes a draw even at
    // p=0, and calling it unconditionally for every Developer every Day would
    // desync the whole downstream RNG stream (candidate rolls, ticket rolls,
    // traffic spikes) from what a Seed produced before Market Pull existed.
    const pullChance = marketPullChance(state, dev.level);
    if (pullChance > 0 && rng.chance(pullChance)) {
      dev.noticeDaysLeft = rng.int(...SIM.noticeDays);
      const share = Math.round(levelShare(state, dev.level) * 100);
      const target = Math.round(SIM.levelTarget[dev.level] * 100);
      pushEvent(
        state,
        'alarm',
        `@${dev.handle} is fielding outside offers -- leaving in ${dev.noticeDaysLeft} days unless retained. (${dev.level}s are ${share}% of the team, target ~${target}%)`,
      );
    }
  }
}

/**
 * Traffic grows on its own schedule and spikes occasionally, independent of MRR.
 * A spike bumps that Day's `traffic` only -- `trafficBaseline` is what actually
 * compounds, so a spike decays back to trend the next Day instead of
 * ratcheting the baseline upward forever.
 */
function doTraffic(state: RunState, rng: Rng): void {
  const stage = stageAt(state.stageIndex);
  const infra = state.infra;
  infra.trafficBaseline *= 1 + stage.trafficDailyGrowth;

  if (rng.chance(stage.trafficSpikeChance)) {
    const mult = rng.float(...stage.trafficSpikeMult);
    infra.traffic = infra.trafficBaseline * mult;
    pushEvent(state, 'warn', `Traffic spike: ${mult.toFixed(1)}x for a day.`);
  } else {
    infra.traffic = infra.trafficBaseline;
  }
}

/**
 * Advances whatever infra change is pending (ADR-0005: main Architecture, the
 * Database engine, or the Runtime -- only one at a time). Completes it once
 * its Days run out.
 */
function doPendingChange(state: RunState): void {
  const infra = state.infra;
  const pending = infra.pending;
  if (!pending) return;

  pending.daysLeft -= 1;
  if (pending.daysLeft > 0) return;
  infra.pending = null;

  if (pending.kind === 'architecture') {
    const to = pending.target as Architecture;
    infra.architecture = to;

    // Compute is reset to roughly what today's Traffic needs under the new
    // Architecture, so finishing a migration doesn't hand the player either
    // an instant shortfall or free excess capacity.
    const need = requiredCapacity(state) * INFRA.migration.startingSafetyMargin;
    const perUnit =
      to === 'monolith' ? INFRA.monolith.capacityPerUnit
      : to === 'kubernetes' ? INFRA.kubernetes.capacityPerNode
      : INFRA.serverless.capacityPerConcurrencyUnit;
    const runtimeMult = RUNTIME_SPECS[infra.runtime].capacityMultiplier;
    infra.compute = Math.max(1, Math.ceil(need / perUnit / runtimeMult / Math.max(computeEfficiency(state), 0.01)));
    pushEvent(state, 'good', `Migration complete -- now running on ${to}.`);
  } else if (pending.kind === 'db') {
    infra.dbEngine = pending.target as DbEngine;
    pushEvent(state, 'good', `Database switch complete -- now running ${DB_ENGINE_SPECS[infra.dbEngine].label}.`);
  } else {
    infra.runtime = pending.target as Runtime;
    pushEvent(state, 'good', `Runtime switch complete -- now running ${RUNTIME_SPECS[infra.runtime].label}.`);
  }
}

/**
 * Advances a pending Workplace change (ADR-0006): either an Office
 * relocation, or a full Work Mode switch. Completes it once its Days run out.
 * A relocation is disruptive only in Velocity; a mode switch also costs some
 * current staff outright -- non-retainable, decided the moment it lands.
 */
function doWorkplaceChange(state: RunState, rng: Rng): void {
  const wp = state.workplace;
  const pending = wp.pending;
  if (!pending) return;

  pending.daysLeft -= 1;
  if (pending.daysLeft > 0) return;
  wp.pending = null;

  if (pending.kind === 'relocate') {
    wp.officeCity = pending.target as string;
    pushEvent(state, 'good', `Office relocation complete -- now based in ${OFFICE_CITIES[wp.officeCity].label}.`);
    return;
  }

  const to = pending.target as WorkMode;
  wp.mode = to;
  if (to === 'inperson') {
    wp.officeCity = pending.destCity ?? Object.keys(OFFICE_CITIES)[0];
    wp.unlockedCountries = [];
  } else {
    wp.officeCity = null;
    wp.unlockedCountries = ['kestria'];
  }

  const leaving = state.developers.filter(() => rng.chance(WORKPLACE.modeSwitch.staffLossChance));
  for (const dev of leaving) releaseTicket(state, dev);
  const leavingIds = new Set(leaving.map((d) => d.id));
  state.developers = state.developers.filter((d) => !leavingIds.has(d.id));

  const dest = to === 'inperson' ? `In-person in ${OFFICE_CITIES[wp.officeCity!].label}` : 'Remote';
  pushEvent(state, 'good', `Work Mode switch complete -- now ${dest}.`);
  if (leaving.length > 0) {
    pushEvent(
      state,
      'alarm',
      `${leaving.length} developer${leaving.length === 1 ? '' : 's'} didn't want to make the move and left: ${leaving.map((d) => `@${d.handle}`).join(', ')}.`,
    );
  }
}

/**
 * How many times a Ticket should have Escalated by now, purely a function of
 * age -- recomputed each Day rather than incremented, so there is no separate
 * "next threshold" state to drift out of sync. Each step's wait halves, down
 * to a floor, so an old Ticket escalates faster and faster.
 */
function escalationsForAge(ageDays: number): number {
  let count = 0;
  let interval: number = SIM.escalationFirstDays;
  let cumulative: number = interval;
  while (ageDays >= cumulative) {
    count++;
    interval = Math.max(4, interval / 2);
    cumulative += interval;
  }
  return count;
}

/** Bugs and Tech Debt left open get worse; the effect is derived, this just tracks the level. */
function doEscalation(state: RunState): void {
  for (const t of state.tickets) {
    if (t.status === 'done' || (t.type !== 'bug' && t.type !== 'tech_debt')) continue;

    const before = t.escalationLevel;
    t.escalationLevel = escalationsForAge(state.day - t.createdDay);
    if (t.escalationLevel > before) {
      const kind = t.type === 'bug' ? 'BUG' : 'DEBT';
      pushEvent(
        state, 'warn',
        `${kind} #${t.handle} escalated to ${effectiveSeverity(t)} -- "${t.title}" has been open ${state.day - t.createdDay} days.`,
      );
    }
  }
}

/** Features left untouched too long are withdrawn -- lost opportunity, not a growing liability. */
function doExpiry(state: RunState): void {
  const expiring = state.tickets.filter(
    (t) => t.type === 'feature' && t.status === 'backlog' && t.expiresDay !== null && state.day >= t.expiresDay,
  );
  for (const t of expiring) {
    pushEvent(state, 'warn', `FEAT #${t.handle} "${t.title}" withdrawn -- ${state.day - t.createdDay} days untouched, ${money(t.revenue)}/mo lost.`);
  }
  if (expiring.length > 0) {
    const expiredIds = new Set(expiring.map((t) => t.id));
    state.tickets = state.tickets.filter((t) => !expiredIds.has(t.id));
  }
}

/**
 * The Cache warms toward its tier's ceiling after a refresh, then decays once
 * stale. A badly stale Cache risks throwing a real integrity Bug -- upkeep,
 * not a one-time purchase.
 */
function doCache(state: RunState, rng: Rng): void {
  const cache = state.infra.cache;
  if (!cache.active) return;

  const tierMax = INFRA.cache.tiers[cache.tier].maxHitRate;
  const age = state.day - cache.lastRefreshedDay;

  if (age <= INFRA.cache.staleAfterDays) {
    cache.hitRate = Math.min(tierMax, cache.hitRate + 0.05);
    return;
  }

  cache.hitRate = Math.max(0, cache.hitRate - INFRA.cache.decayPerDay);
  if (cache.hitRate < tierMax * INFRA.cache.integrityRiskFraction && rng.chance(INFRA.cache.integrityBugChance)) {
    const bug: Ticket = { ...rollTicket(state, rng, 'bug'), severity: 'high' };
    state.tickets.push(bug);
    pushEvent(state, 'alarm', `Stale cache produced a data-integrity bug: #${bug.handle} "${bug.title}".`);
  }
}

/**
 * A Managed Database autoscales on its own -- replicas track required Capacity
 * every Day, up or down, rather than the player buying a fixed count with
 * /scale. That convenience is what the higher costMultiplier is paying for.
 */
function doManagedDbAutoscale(state: RunState): void {
  const infra = state.infra;
  if (infra.dbEngine !== 'managed') return;

  const spec = DB_ENGINE_SPECS.managed;
  const perReplica = INFRA.db.capacityPerReplica * spec.capacityMultiplier * Math.max(dbEfficiency(state), 0.01);
  const need = requiredCapacity(state) * INFRA.db.autoscaleMargin;
  infra.dbReplicas = Math.max(1, Math.ceil(need / perReplica));
}

/** Alerts once when the system crosses into Over Capacity (ADR-0004). */
function doInfraAlerts(state: RunState, wasOver: boolean): void {
  const isOver = utilization(state) > 1;
  if (isOver && !wasOver) {
    pushEvent(state, 'alarm', `OVER CAPACITY: traffic exceeds what ${state.infra.architecture} can serve -- churn rising. /infra, /scale.`);
  } else if (!isOver && wasOver) {
    pushEvent(state, 'good', 'Capacity restored -- churn pressure from infra cleared.');
  }
}

function doFinances(state: RunState): void {
  // Churn compounds daily at the monthly rate, so MRR always decays.
  const daily = 1 - Math.pow(1 - churnRate(state), 1 / SIM.daysPerMonth);
  state.mrr = Math.max(0, state.mrr * (1 - daily));
  state.cash += (state.mrr - burn(state)) / SIM.daysPerMonth;
}

function doArrivals(state: RunState, rng: Rng): void {
  const stage = stageAt(state.stageIndex);
  const avgPoints = expectedTicketPoints(stage);
  // Work scales with headcount, but the per-head multiplier rises by Stage --
  // a bigger, later-stage product throws off more incoming work per engineer,
  // not just more heads. The backlog is meant to outpace hiring, not track it.
  const scale = stage.arrivalBaseSp + state.developers.length * stage.arrivalTeamMultiplier;

  for (const type of ['feature', 'bug', 'tech_debt'] as TicketType[]) {
    if (!rng.chance((stage.arrivalSp[type] * scale) / avgPoints)) continue;
    const ticket = rollTicket(state, rng, type);
    state.tickets.push(ticket);

    if (type === 'bug') {
      const level: EventLevel = ticket.severity === 'critical' ? 'alarm' : 'warn';
      pushEvent(state, level, `BUG #${ticket.handle} "${ticket.title}" (${ticket.severity}, ${ticket.storyPoints}sp) -- churn rising.`);
    } else if (type === 'tech_debt') {
      pushEvent(state, 'info', `DEBT #${ticket.handle} "${ticket.title}" (${ticket.storyPoints}sp) -- team slowing.`);
    } else {
      pushEvent(state, 'info', `FEAT #${ticket.handle} "${ticket.title}" (${ticket.storyPoints}sp, +${money(ticket.revenue)}/mo)`);
    }
  }

  const maxCandidates = SIM.maxCandidates + workplacePoolBonus(state.workplace);
  if (state.candidates.length < maxCandidates && rng.chance(stage.candidateRate)) {
    const candidate = rollCandidate(state, rng);
    state.candidates.push(candidate);
    pushEvent(state, 'info', `@${candidate.handle} applied -- ${candidate.level}, ${money(candidate.salary)}/mo. /hire @${candidate.handle}`);
  }

  const expired = state.candidates.filter((c) => c.expiresDay <= state.day);
  for (const c of expired) pushEvent(state, 'info', `@${c.handle} took another offer.`);
  state.candidates = state.candidates.filter((c) => c.expiresDay > state.day);
}

/**
 * Standing auto-assign. Uses the same Triage as the `/auto` command, so what the
 * mode does is exactly what the one-shot would have done.
 */
function doAutoAssign(state: RunState): void {
  if (!state.autoAssign) return;
  const idle = idleDevelopers(state);
  if (idle.length === 0) return;

  for (const { developer, ticket, days } of planAssignments(state, idle, state.autoFocus)) {
    const dev = state.developers.find((d) => d.id === developer.id);
    const target = state.tickets.find((t) => t.id === ticket.id);
    if (!dev || !target) continue;

    dev.currentTicketId = target.id;
    target.assignedTo = dev.id;
    target.status = 'in_progress';
    pushEvent(state, 'info', `auto: @${dev.handle} -> #${target.handle} "${target.title}" (~${days}d)`);
  }
}

function doStageGate(state: RunState): void {
  const stage = stageAt(state.stageIndex);
  if (state.mrr < stage.goalMrr) return;

  const next = state.stageIndex + 1;
  if (next >= STAGES.length) {
    state.status = 'won';
    pushEvent(state, 'good', `IPO. ${money(state.mrr)}/mo MRR on day ${state.day}. You win.`);
    return;
  }

  const nextStage = STAGES[next];
  state.stageIndex = next;
  state.cash += nextStage.fundingCash;
  pushEvent(state, 'good', `${stage.name} goal met -- ${nextStage.name} round closed, +${money(nextStage.fundingCash)}.`);
  pushEvent(state, 'info', `Next goal: ${money(nextStage.goalMrr)}/mo MRR. Salaries and churn are up.`);

  if (state.workplace.mode === null) {
    pushEvent(
      state,
      'alarm',
      `Choose a Work Mode before the clock runs again: /workmode inperson <city> or /workmode remote.`,
    );
  }
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export function tick(state: RunState): RunState {
  if (state.status !== 'running') return state;
  // ADR-0006: the clock will not run again once Seed opens until a Work Mode
  // is chosen -- mirrors how the Run starts unpaused only because that choice
  // hasn't come up yet.
  if (state.stageIndex >= 1 && state.workplace.mode === null) return state;

  const next = draft(state);
  const rng = createRng(next.rng.seed, next.rng.cursor);
  next.day += 1;

  doWork(next);
  doAttrition(next, rng);
  doEscalation(next);
  doExpiry(next);
  doFinances(next);
  const wasOver = utilization(next) > 1;
  doTraffic(next, rng);
  doCache(next, rng);
  doPendingChange(next);
  doWorkplaceChange(next, rng);
  doManagedDbAutoscale(next);
  doArrivals(next, rng);
  doAutoAssign(next);
  doInfraAlerts(next, wasOver);
  doStageGate(next);

  const done = next.tickets.filter((t) => t.status === 'done');
  if (done.length > MAX_DONE_TICKETS) {
    const cutoff = done
      .map((t) => t.completedDay ?? 0)
      .sort((a, b) => b - a)[MAX_DONE_TICKETS - 1];
    next.tickets = next.tickets.filter((t) => t.status !== 'done' || (t.completedDay ?? 0) >= cutoff);
  }

  if (next.status === 'running' && next.cash < 0) {
    next.status = 'lost';
    pushEvent(next, 'alarm', `Out of cash on day ${next.day}. The company is insolvent.`);
  }

  next.rng = rng.state();
  return next;
}

/** Convenience for the balance harness: run N days or until the Run ends. */
export function run(state: RunState, days: number): RunState {
  let s = state;
  for (let i = 0; i < days && s.status === 'running'; i++) s = tick(s);
  return s;
}
