/**
 * One Day of simulation. Pure: tick(state) -> state.
 *
 * Order matters. Work resolves before Churn so a Ticket shipped today earns from
 * today, and Bankruptcy is checked last and every Day -- the old code only looked
 * every 30 Days, so a company could be insolvent for a month without noticing.
 */

import {
  burn, churnRate, computeEfficiency, effectiveVelocity, requiredCapacity, utilization, velocityMultiplier,
} from './economy';
import { createRng, Rng } from './rng';
import { rollCandidate, rollTicket } from './roll';
import { expectedTicketPoints, INFRA, SIM, stageAt, STAGES } from './tuning';
import { idleDevelopers, planAssignments } from './triage';
import { Developer, EventLevel, GameEvent, RunState, TicketType } from './types';

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
    infra: { ...state.infra },
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
      SIM.moraleDrain[ticket.severity] * (ticket.type === 'bug' ? SIM.bugMoraleMultiplier : 1);
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
      }
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

/** Advances an in-progress Migration; completes it once its Days run out. */
function doMigration(state: RunState): void {
  const infra = state.infra;
  if (infra.migratingTo === null || infra.migrationDaysLeft === null) return;

  infra.migrationDaysLeft -= 1;
  if (infra.migrationDaysLeft > 0) return;

  const to = infra.migratingTo;
  infra.architecture = to;
  infra.migratingTo = null;
  infra.migrationDaysLeft = null;

  // Compute is reset to roughly what today's Traffic needs under the new
  // Architecture, so finishing a migration doesn't hand the player either an
  // instant shortfall or free excess capacity.
  const need = requiredCapacity(state) * INFRA.migration.startingSafetyMargin;
  const perUnit =
    to === 'monolith' ? INFRA.monolith.capacityPerUnit
    : to === 'kubernetes' ? INFRA.kubernetes.capacityPerNode
    : INFRA.serverless.capacityPerConcurrencyUnit;
  infra.compute = Math.max(1, Math.ceil(need / perUnit / Math.max(computeEfficiency(state), 0.01)));

  pushEvent(state, 'good', `Migration complete -- now running on ${to}.`);
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
  // Work scales with headcount, so hiring buys throughput and inbox at once.
  const scale = SIM.arrivalBaseSp + state.developers.length;

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

  if (state.candidates.length < SIM.maxCandidates && rng.chance(stage.candidateRate)) {
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

  for (const { developer, ticket, days } of planAssignments(state, idle)) {
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
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export function tick(state: RunState): RunState {
  if (state.status !== 'running') return state;

  const next = draft(state);
  const rng = createRng(next.rng.seed, next.rng.cursor);
  next.day += 1;

  doWork(next);
  doAttrition(next, rng);
  doFinances(next);
  const wasOver = utilization(next) > 1;
  doTraffic(next, rng);
  doMigration(next);
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
