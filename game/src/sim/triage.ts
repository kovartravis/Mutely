/**
 * Assignment triage -- the single valuation shared by the player's `/auto`
 * command and the balance harness's reference player.
 *
 * Keeping one implementation matters: if the two drifted, the win rates the
 * harness reports would stop describing the game the player is actually handed.
 */

import { churnRate, effectiveVelocity, isOpen, velocityMultiplier } from './economy';
import { SIM, stageAt } from './tuning';
import { Developer, RunState, Ticket } from './types';

export interface Assignment {
  developer: Developer;
  ticket: Ticket;
  /** Steady-state dollars per day of the developer's time. */
  value: number;
  velocity: number;
  days: number;
}

/**
 * Everything is priced in steady-state MRR. At equilibrium MRR = R / c, where R
 * is monthly shipped revenue and c the churn rate, so:
 *
 *   a feature raises R      -> worth its own revenue
 *   a bug fix lowers c      -> worth mrr * dc / c, which grows as bugs pile up
 *   a debt fix raises drag  -> worth mrr * (drag' / drag - 1)
 *
 * Pricing bugs at a flat mrr*dc -- the obvious mistake -- undervalues them ~6x.
 */
export function valuePerDay(state: RunState, dev: Developer, ticket: Ticket): number {
  const dragNow = velocityMultiplier(state);
  const velocity = effectiveVelocity(dev, ticket, dragNow);
  if (velocity <= 0.01) return 0;
  const days = (ticket.storyPoints - ticket.progressPoints) / velocity;

  let value: number;
  if (ticket.type === 'feature') {
    value = ticket.revenue;
  } else if (ticket.type === 'bug') {
    const dc = stageAt(state.stageIndex).baseChurn * SIM.bugChurnWeight[ticket.severity];
    value = (state.mrr * dc) / Math.max(churnRate(state), 1e-6);
  } else {
    const w = SIM.debtDragWeight[ticket.severity];
    const totalW = 1 / dragNow - 1;
    const improved = 1 / (1 + Math.max(0, totalW - w));
    value = state.mrr * (improved / dragNow - 1);
  }

  // Early on there is no MRR, so bug and debt work prices at zero and features
  // win by default. Floor non-feature work at its size so the board still gets
  // triaged sensibly before revenue exists.
  if (value <= 0 && ticket.type !== 'feature') value = ticket.storyPoints;

  return value / Math.max(days, 0.5);
}

/**
 * Best available pairing of the given Developers to open, unclaimed Tickets.
 *
 * Globally greedy: every pair is scored, then the highest-value pairs are taken
 * first. Assigning developer-by-developer instead lets whoever is first in the
 * array take a ticket that someone else would have cleared far faster.
 */
export function planAssignments(state: RunState, developers: readonly Developer[]): Assignment[] {
  const claimed = new Set(
    state.tickets.filter((t) => t.status === 'in_progress').map((t) => t.id),
  );
  const open = state.tickets.filter((t) => isOpen(t) && !claimed.has(t.id));
  const dragNow = velocityMultiplier(state);

  const pairs: Assignment[] = [];
  for (const dev of developers) {
    for (const ticket of open) {
      const value = valuePerDay(state, dev, ticket);
      if (value <= 0) continue;
      const velocity = effectiveVelocity(dev, ticket, dragNow);
      pairs.push({
        developer: dev,
        ticket,
        value,
        velocity,
        days: Math.ceil((ticket.storyPoints - ticket.progressPoints) / Math.max(velocity, 1e-6)),
      });
    }
  }

  pairs.sort((a, b) => b.value - a.value || a.ticket.handle.localeCompare(b.ticket.handle));

  const takenDevs = new Set<string>();
  const takenTickets = new Set<string>();
  const plan: Assignment[] = [];
  for (const pair of pairs) {
    if (takenDevs.has(pair.developer.id) || takenTickets.has(pair.ticket.id)) continue;
    takenDevs.add(pair.developer.id);
    takenTickets.add(pair.ticket.id);
    plan.push(pair);
  }
  return plan;
}

/** Developers with no current Ticket. */
export function idleDevelopers(state: RunState): Developer[] {
  return state.developers.filter((d) => !d.currentTicketId);
}
