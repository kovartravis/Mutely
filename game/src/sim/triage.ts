/**
 * Assignment triage -- the single valuation shared by the player's `/auto`
 * command and the balance harness's reference player.
 *
 * Keeping one implementation matters: if the two drifted, the win rates the
 * harness reports would stop describing the game the player is actually handed.
 */

import {
  churnRate, debtInflation, debtInflationWeight, effectiveSeverity, effectiveVelocity,
  infraCost, isOpen, velocityMultiplier,
} from './economy';
import { SIM, stageAt } from './tuning';
import { Developer, RunState, Ticket, TicketType } from './types';

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
 * Independent of any particular Developer, so it also ranks the backlog itself
 * (`/board`'s default view) without inventing a hypothetical assignee.
 */
export function ticketValue(state: RunState, ticket: Ticket, dragNow: number): number {
  const severity = effectiveSeverity(ticket);
  let value: number;
  if (ticket.type === 'feature') {
    value = ticket.revenue;
  } else if (ticket.type === 'bug') {
    const dc = stageAt(state.stageIndex).baseChurn * SIM.bugChurnWeight[severity];
    value = (state.mrr * dc) / Math.max(churnRate(state), 1e-6);
  } else {
    // Tech Debt attacks two Pressures at once (ADR-0004): fixing it relieves
    // Drag on Velocity, AND removes its share of the Capacity inflation that
    // drives up the infra bill. Pricing only the first term is exactly why an
    // old, ignored debt ticket used to look worthless right up until its
    // uncapped infra cost quietly bankrupted the company -- see ADR-0004
    // and the balance notes for 2026-09-06.
    const w = SIM.debtDragWeight[severity];
    const totalW = 1 / dragNow - 1;
    const improved = 1 / (1 + Math.max(0, totalW - w));
    const dragValue = state.mrr * (improved / dragNow - 1);

    const totalInflationWeight = debtInflation(state) - 1;
    const thisWeight = debtInflationWeight(ticket);
    const fractionOfInflation = totalInflationWeight > 0 ? thisWeight / totalInflationWeight : 0;
    const infraValue = infraCost(state) * fractionOfInflation;

    value = dragValue + infraValue;
  }

  // Early on there is no MRR, so bug and debt work prices at zero and features
  // win by default. Floor non-feature work at its size so the board still gets
  // triaged sensibly before revenue exists.
  if (value <= 0 && ticket.type !== 'feature') value = ticket.storyPoints;
  return value;
}

export function valuePerDay(state: RunState, dev: Developer, ticket: Ticket): number {
  const dragNow = velocityMultiplier(state);
  const velocity = effectiveVelocity(dev, ticket, dragNow);
  if (velocity <= 0.01) return 0;
  const days = (ticket.storyPoints - ticket.progressPoints) / velocity;
  return ticketValue(state, ticket, dragNow) / Math.max(days, 0.5);
}

/**
 * Added to a pair's sort key (never its displayed `value`) when its Ticket
 * matches the active auto-Focus. Large enough to dominate any real economic
 * value, so a focused Ticket always wins the assignment when one is open --
 * but an idle Developer still falls back to the next-best work of any type
 * when the focus queue is empty, rather than sitting idle.
 */
const FOCUS_BOOST = 1e9;

/**
 * Best available pairing of the given Developers to open, unclaimed Tickets.
 *
 * Globally greedy: every pair is scored, then the highest-value pairs are taken
 * first. Assigning developer-by-developer instead lets whoever is first in the
 * array take a ticket that someone else would have cleared far faster.
 */
export function planAssignments(
  state: RunState,
  developers: readonly Developer[],
  focus: TicketType | null = null,
): Assignment[] {
  const claimed = new Set(
    state.tickets.filter((t) => t.status === 'in_progress').map((t) => t.id),
  );
  const open = state.tickets.filter((t) => isOpen(t) && !claimed.has(t.id));
  const dragNow = velocityMultiplier(state);

  const pairs: Assignment[] = [];
  const sortKeys = new Map<Assignment, number>();
  for (const dev of developers) {
    for (const ticket of open) {
      const value = valuePerDay(state, dev, ticket);
      if (value <= 0) continue;
      const velocity = effectiveVelocity(dev, ticket, dragNow);
      const pair: Assignment = {
        developer: dev,
        ticket,
        value,
        velocity,
        days: Math.ceil((ticket.storyPoints - ticket.progressPoints) / Math.max(velocity, 1e-6)),
      };
      pairs.push(pair);
      sortKeys.set(pair, focus && ticket.type === focus ? value + FOCUS_BOOST : value);
    }
  }

  pairs.sort((a, b) => sortKeys.get(b)! - sortKeys.get(a)! || a.ticket.handle.localeCompare(b.ticket.handle));

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
