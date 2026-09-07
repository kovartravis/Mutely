/**
 * The whole input surface (ADR-0002). Pure: apply(state, input) -> result.
 *
 * Anything that needs the outside world (save slots, restart) is returned as an
 * Effect for the app layer to carry out, so the core stays free of storage.
 */

import {
  cacheCost, computeCost, computeEfficiency, daysRemaining, dbCost, dbEfficiency, debtInflation,
  effectiveCapacity, effectiveSeverity, effectiveVelocity, finances, infraCost, isOpen,
  utilization, velocityMultiplier,
} from './economy';
import { resolveCandidate, resolveDeveloper, resolveTicket } from './handles';
import { hireCandidate, isPromotable, nextLevel, topDiscipline } from './roll';
import { idleDevelopers, planAssignments, ticketValue } from './triage';
import { DB_ENGINE_SPECS, INFRA, RUNTIME_SPECS, SIM, stageAt, STAGES } from './tuning';
import { pushEvent } from './tick';
import {
  ARCHITECTURES, Architecture, DB_ENGINES, DbEngine, Developer, DISCIPLINES, PendingChange,
  RunState, RUNTIMES, Runtime, Ticket,
} from './types';

export type Effect =
  | { kind: 'save'; name: string }
  | { kind: 'load'; name: string }
  | { kind: 'list_saves' }
  | { kind: 'delete_save'; name: string }
  | { kind: 'restart' }
  | { kind: 'toggle_overlay'; overlay: 'architecture' };

export interface CommandResult {
  state: RunState;
  effect?: Effect;
}

export interface CommandSpec {
  name: string;
  /** Argument shapes, used to drive tab-completion. */
  args: Array<
    'dev' | 'candidate' | 'ticket' | 'number' | 'text' | 'speed' | 'save' | 'automode'
    | 'architecture' | 'infratarget' | 'confirm' | 'boardfilter' | 'switchaxis'
    | 'dbengine' | 'runtime' | 'cacheaction'
  >;
  summary: string;
}

export const COMMANDS: CommandSpec[] = [
  { name: '/help',     args: [],                    summary: 'list commands' },
  { name: '/board',    args: ['boardfilter'],       summary: 'urgent tickets; all|bug|feature|debt|stale to filter' },
  { name: '/team',     args: [],                    summary: 'the team, proficiency and morale' },
  { name: '/status',   args: [],                    summary: 'stage progress and the four pressures' },
  { name: '/ticket',   args: ['ticket'],            summary: 'detail on one ticket' },
  { name: '/dev',      args: ['dev'],               summary: 'detail on one developer' },
  { name: '/assign',   args: ['dev', 'ticket'],     summary: 'put a developer on a ticket' },
  { name: '/unassign', args: ['dev'],               summary: 'take a developer off their ticket' },
  { name: '/auto',     args: ['automode'],          summary: 'keep idle developers assigned (off | once)' },
  { name: '/hire',     args: ['candidate'],         summary: 'candidates, or hire one' },
  { name: '/fire',     args: ['dev'],               summary: 'let a developer go (1 month severance)' },
  { name: '/promote',  args: ['dev'],               summary: 'promote a developer once eligible' },
  { name: '/raise',    args: ['dev', 'number'],     summary: 'permanent monthly raise, lifts morale' },
  { name: '/bonus',    args: ['dev', 'number'],     summary: 'one-off cash bonus, lifts morale' },
  { name: '/speed',    args: ['speed'],             summary: 'set clock speed: 0 1 2 4' },
  { name: '/pause',    args: [],                    summary: 'stop the clock' },
  { name: '/resume',   args: [],                    summary: 'start the clock' },
  { name: '/save',     args: ['text'],              summary: 'save this run under a name' },
  { name: '/load',     args: ['save'],              summary: 'load a saved run' },
  { name: '/saves',    args: [],                    summary: 'list save slots' },
  { name: '/infra',       args: [],                          summary: 'architecture, capacity, and infra cost' },
  { name: '/architecture', args: [],                         summary: 'open the full architecture diagram' },
  { name: '/scale',       args: ['infratarget', 'number'],   summary: 'add or remove compute or db capacity' },
  { name: '/migrate',     args: ['architecture', 'confirm'], summary: 'switch architecture (costly, takes days)' },
  { name: '/switch',      args: ['switchaxis', 'dbengine', 'confirm'], summary: 'switch database engine or runtime' },
  { name: '/cache',       args: ['cacheaction'],             summary: 'buy, upgrade, or refresh the cache' },
  { name: '/seed',     args: [],                    summary: 'show this run seed' },
  { name: '/restart',  args: [],                    summary: 'abandon this run and start over' },
];

// ─── Formatting ──────────────────────────────────────────────────────────────

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length));
const padL = (s: string, n: number) => (s.length >= n ? s : ' '.repeat(n - s.length) + s);

function bar(fraction: number, width = 10): string {
  const filled = Math.max(0, Math.min(width, Math.round(fraction * width)));
  return '▓'.repeat(filled) + '░'.repeat(width - filled);
}

const TYPE_LABEL = { feature: 'FEAT', bug: 'BUG ', tech_debt: 'DEBT' } as const;

function computeLabel(architecture: Architecture): string {
  return architecture === 'monolith' ? 'tier' : architecture === 'kubernetes' ? 'node' : 'concurrency unit';
}

function describePending(pending: PendingChange): string {
  const noun = pending.kind === 'architecture' ? 'migrating to' : pending.kind === 'db' ? 'switching database to' : 'switching runtime to';
  return `${noun} ${pending.target} (${pending.daysLeft}d left)`;
}

function pendingLabel(pending: PendingChange | null): string {
  return pending ? `  -> ${describePending(pending)}` : '';
}

/** Tickets stop showing up in the bare /board's "hidden" count past this age. */
const STALE_AFTER_DAYS = 30;
/** Bare /board caps at this many rows before pointing at the filters. */
const BOARD_URGENT_SIZE = 14;

function ticketLine(state: RunState, t: Ticket): string {
  const dev = t.assignedTo ? state.developers.find((d) => d.id === t.assignedTo) : null;
  const who = dev ? `@${dev.handle}` : '--';
  const progress = t.progressPoints > 0 ? bar(t.progressPoints / t.storyPoints, 6) : '      ';
  const severity = effectiveSeverity(t);
  const esc = t.escalationLevel > 0 ? ` ^${t.escalationLevel}` : '';
  const expiry = t.type === 'feature' && t.expiresDay !== null
    ? `  exp ${Math.max(0, t.expiresDay - state.day)}d` : '';
  return `  #${pad(t.handle, 4)} ${TYPE_LABEL[t.type]} ${pad(severity, 8)}${esc.padEnd(3)}${pad(t.discipline, 9)}${padL(String(t.storyPoints), 3)}sp ${progress} ${pad(who, 9)}${t.title}${expiry}`;
}

function devLine(state: RunState, d: Developer): string {
  const ticket = d.currentTicketId ? state.tickets.find((t) => t.id === d.currentTicketId) : null;
  const top = topDiscipline(d.proficiency);
  const working = ticket ? `#${ticket.handle}` : '--';
  const notice = d.noticeDaysLeft !== null ? `  NOTICE ${d.noticeDaysLeft}d` : '';
  const promo = notice === '' && isPromotable(d) ? '  ▲ promotable' : '';
  return `  @${pad(d.handle, 10)}${pad(d.level, 7)}${pad(top, 9)}${padL(String(Math.round(d.proficiency[top])), 3)}  morale ${padL(String(Math.round(d.morale)), 3)}  ${padL(money(d.salary), 8)}/mo  ${pad(working, 5)}${notice}${promo}`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function clone(state: RunState): RunState {
  return {
    ...state,
    developers: state.developers.map((d) => ({ ...d, proficiency: { ...d.proficiency } })),
    candidates: state.candidates.map((c) => ({ ...c })),
    tickets: state.tickets.map((t) => ({ ...t })),
    events: state.events.slice(),
    infra: {
      ...state.infra,
      cache: { ...state.infra.cache },
      pending: state.infra.pending ? { ...state.infra.pending } : null,
    },
  };
}

const reply = (s: RunState, text: string) => pushEvent(s, 'reply', text);
const fail = (s: RunState, text: string) => pushEvent(s, 'alarm', text);

/** Detaches a Developer from whatever they are on, returning the Ticket to the backlog. */
function release(state: RunState, dev: Developer): void {
  if (!dev.currentTicketId) return;
  const t = state.tickets.find((x) => x.id === dev.currentTicketId);
  if (t && t.status === 'in_progress') {
    t.status = 'backlog';
    t.assignedTo = null;
  }
  dev.currentTicketId = null;
}

/** Cash spent on a Developer can pull them back from Notice. */
function applyMoraleSpend(state: RunState, dev: Developer, moraleGain: number, how: string): void {
  dev.morale = Math.min(100, dev.morale + moraleGain);
  if (dev.noticeDaysLeft !== null && dev.morale >= SIM.retentionMoraleFloor) {
    dev.noticeDaysLeft = null;
    dev.morale = Math.max(dev.morale, SIM.retentionMoraleFloor);
    pushEvent(state, 'good', `@${dev.handle} withdrew their notice after the ${how}.`);
  }
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export function apply(input: RunState, raw: string): CommandResult {
  const state = clone(input);
  const line = raw.trim();
  if (!line) return { state };

  pushEvent(state, 'command', line);

  const parts = line.split(/\s+/);
  const name = parts[0].toLowerCase();
  const args = parts.slice(1);

  switch (name) {
    case '/help': {
      reply(state, 'COMMANDS');
      for (const c of COMMANDS) reply(state, `  ${pad(c.name, 11)}${c.summary}`);
      reply(state, 'Targets are handles: @marcus for people, #a3 for tickets. TAB completes both.');
      return { state };
    }

    case '/board': {
      const filter = (args[0] ?? '').toLowerCase();
      const open = state.tickets.filter(isOpen);
      if (open.length === 0) { reply(state, 'Backlog is empty.'); return { state }; }

      const dragNow = velocityMultiplier(state);
      const byValue = (a: Ticket, b: Ticket) => ticketValue(state, b, dragNow) - ticketValue(state, a, dragNow);
      const isStale = (t: Ticket) => state.day - t.createdDay >= STALE_AFTER_DAYS;
      const isUrgent = (t: Ticket) =>
        t.escalationLevel > 0 || (t.type === 'feature' && t.expiresDay !== null && t.expiresDay - state.day <= 10);

      if (filter === 'all') {
        const sorted = [...open].sort(byValue);
        reply(state, `BACKLOG  ${sorted.length} open, by value`);
        for (const t of sorted) reply(state, ticketLine(state, t));
        return { state };
      }
      if (filter === 'bug' || filter === 'feature' || filter === 'debt') {
        const type = filter === 'debt' ? 'tech_debt' : filter;
        const filtered = open.filter((t) => t.type === type).sort(byValue);
        reply(state, `${filter.toUpperCase()}  ${filtered.length} open`);
        for (const t of filtered) reply(state, ticketLine(state, t));
        return { state };
      }
      if (filter === 'stale') {
        const stale = open.filter(isStale).sort((a, b) => a.createdDay - b.createdDay);
        if (stale.length === 0) { reply(state, `No ticket has been open ${STALE_AFTER_DAYS}+ days.`); return { state }; }
        reply(state, `STALE  ${stale.length} ticket${stale.length === 1 ? '' : 's'} open ${STALE_AFTER_DAYS}+ days`);
        for (const t of stale) reply(state, ticketLine(state, t));
        return { state };
      }
      if (filter) {
        fail(state, `Usage: /board [all|bug|feature|debt|stale]`);
        return { state };
      }

      // Bare /board: what actually needs a decision, not the whole pile.
      const urgent = open.filter(isUrgent).sort(byValue);
      const filler = open.filter((t) => !isUrgent(t)).sort(byValue).slice(0, Math.max(0, BOARD_URGENT_SIZE - urgent.length));
      const shown = [...urgent, ...filler];
      const hidden = open.length - shown.length;

      reply(state, `BACKLOG  ${shown.length} of ${open.length} open shown${hidden > 0 ? `, ${hidden} hidden` : ''}`);
      for (const t of shown) reply(state, ticketLine(state, t));
      if (hidden > 0) reply(state, `/board all -- see everything  ·  /board bug|feature|debt|stale -- filter`);
      return { state };
    }

    case '/team': {
      if (state.developers.length === 0) { reply(state, 'No developers. /hire someone.'); return { state }; }
      reply(state, `TEAM  ${state.developers.length}  burn ${money(finances(state).burn)}/mo`);
      for (const d of state.developers) reply(state, devLine(state, d));
      return { state };
    }

    case '/status': {
      const f = finances(state);
      const stage = stageAt(state.stageIndex);
      const openBugs = state.tickets.filter((t) => t.type === 'bug' && isOpen(t)).length;
      const openDebt = state.tickets.filter((t) => t.type === 'tech_debt' && isOpen(t)).length;
      reply(state, `STAGE ${state.stageIndex + 1}/${STAGES.length}  ${stage.name}   day ${state.day}`);
      reply(state, `  goal    ${bar(state.mrr / stage.goalMrr)} ${money(state.mrr)} / ${money(stage.goalMrr)} MRR`);
      reply(state, `  cash    ${money(f.cash)}   burn ${money(f.burn)}/mo   runway ${f.runway === Infinity ? 'inf' : f.runway.toFixed(1) + ' mo'}`);
      reply(state, `  churn   ${pct(f.churnRate)}/mo  from ${openBugs} open bug${openBugs === 1 ? '' : 's'}  (base ${pct(stage.baseChurn)})`);
      reply(state, `  drag    ${f.drag.toFixed(2)}x velocity  from ${openDebt} open debt ticket${openDebt === 1 ? '' : 's'}`);
      const u = utilization(state);
      reply(state, `  infra   ${(u * 100).toFixed(0)}% capacity  on ${state.infra.architecture}${u > 1 ? '  OVER CAPACITY -- churn rising' : ''}  ·  /infra for detail`);
      return { state };
    }

    case '/infra': {
      const infra = state.infra;
      const u = utilization(state);
      const debt = debtInflation(state);
      const cCost = computeCost(infra);
      const dCost = dbCost(infra);
      const cache = infra.cache;
      const label = computeLabel(infra.architecture);

      reply(state, `ARCHITECTURE  ${infra.architecture.toUpperCase()}${pendingLabel(infra.pending)}`);
      reply(state, `  traffic     ${Math.round(infra.traffic).toLocaleString()} req/day`);
      reply(state, `  capacity    ${Math.round(effectiveCapacity(state)).toLocaleString()} req/day  (${(u * 100).toFixed(0)}% utilized)${u > 1 ? '  OVER CAPACITY -- churn rising' : ''}`);
      if (debt > 1) reply(state, `  debt load   x${debt.toFixed(2)}  (open tech debt inflates required capacity)`);
      reply(state, `  compute     ${infra.compute} ${label}${infra.compute === 1 ? '' : 's'}  ·  ${RUNTIME_SPECS[infra.runtime].label}  ·  ${money(cCost)}/mo  ·  efficiency ${computeEfficiency(state).toFixed(2)}x (devops)`);
      reply(state, `  database    ${infra.dbReplicas} replica${infra.dbReplicas === 1 ? '' : 's'}${infra.dbEngine === 'managed' ? ' (auto)' : ''}  ·  ${DB_ENGINE_SPECS[infra.dbEngine].label}  ·  ${money(dCost)}/mo  ·  efficiency ${dbEfficiency(state).toFixed(2)}x (dba)`);
      if (cache.active) {
        reply(state, `  cache       tier ${cache.tier}  ·  ${(cache.hitRate * 100).toFixed(0)}% hit rate  ·  ${money(cacheCost(infra))}/mo  ·  refreshed ${state.day - cache.lastRefreshedDay}d ago`);
      }
      reply(state, `  total       ${money(cCost + dCost + cacheCost(infra))}/mo`);
      reply(state, '/architecture for the full diagram  ·  /scale, /switch, /cache, /migrate to act');
      return { state };
    }

    case '/architecture':
      return { state, effect: { kind: 'toggle_overlay', overlay: 'architecture' } };

    case '/scale': {
      const target = (args[0] ?? '').toLowerCase();
      const delta = Number(args[1]);
      if (target !== 'compute' && target !== 'db') {
        fail(state, 'Usage: /scale compute|db <+/-N>');
        return { state };
      }
      if (!Number.isFinite(delta) || delta === 0) {
        fail(state, 'Usage: /scale compute|db <+/-N>, e.g. /scale compute +2');
        return { state };
      }

      const infra = state.infra;
      if (target === 'compute') {
        const before = infra.compute;
        infra.compute = Math.max(1, Math.round(infra.compute + delta));
        reply(state, `Compute ${before} -> ${infra.compute}. ${money(computeCost(infra))}/mo.`);
      } else {
        if (infra.dbEngine === 'managed') {
          fail(state, 'Managed replicas autoscale on their own -- nothing to /scale here.');
          return { state };
        }
        const before = infra.dbReplicas;
        infra.dbReplicas = Math.max(1, Math.round(infra.dbReplicas + delta));
        reply(state, `Database replicas ${before} -> ${infra.dbReplicas}. ${money(dbCost(infra))}/mo.`);
      }

      const u = utilization(state);
      reply(state, `Utilization now ${(u * 100).toFixed(0)}%${u > 1 ? ' -- still over capacity' : ''}.`);
      return { state };
    }

    case '/migrate': {
      const to = (args[0] ?? '').toLowerCase() as Architecture;
      if (!ARCHITECTURES.includes(to)) {
        fail(state, `Usage: /migrate <${ARCHITECTURES.join('|')}>`);
        return { state };
      }
      if (state.infra.pending !== null) {
        fail(state, `Already ${describePending(state.infra.pending)}. Wait for it to finish.`);
        return { state };
      }
      if (to === state.infra.architecture) {
        fail(state, `Already running on ${to}.`);
        return { state };
      }

      const cost = INFRA.migration.costBase + infraCost(state) * INFRA.migration.costMonthsOfInfra;
      const confirmed = (args[1] ?? '').toLowerCase() === 'confirm';

      if (!confirmed) {
        reply(state, `MIGRATE ${state.infra.architecture.toUpperCase()} -> ${to.toUpperCase()}`);
        reply(state, `  cost         ${money(cost)}`);
        reply(state, `  duration     ${INFRA.migration.days[0]}-${INFRA.migration.days[1]} days at ${(INFRA.migration.velocityPenalty * 100).toFixed(0)}% team velocity`);
        reply(state, `  confirm with /migrate ${to} confirm`);
        return { state };
      }

      if (state.cash < cost) {
        fail(state, `Need ${money(cost)}; you have ${money(state.cash)}.`);
        return { state };
      }

      state.cash -= cost;
      // Commands are deterministic (no Rng reaches here) so the duration is
      // fixed at the midpoint of the Tuning Table's range, rather than rolled.
      const days = Math.round((INFRA.migration.days[0] + INFRA.migration.days[1]) / 2);
      state.infra.pending = { kind: 'architecture', target: to, daysLeft: days };
      pushEvent(state, 'alarm', `Migration to ${to} started. ${money(cost)} charged. ${days} days at reduced velocity.`);
      return { state };
    }

    case '/switch': {
      const axis = (args[0] ?? '').toLowerCase();
      if (axis !== 'db' && axis !== 'runtime') {
        fail(state, 'Usage: /switch db|runtime <target>');
        return { state };
      }
      const target = (args[1] ?? '').toLowerCase();
      const infra = state.infra;

      if (infra.pending !== null) {
        fail(state, `Already ${describePending(infra.pending)}. Wait for it to finish.`);
        return { state };
      }

      if (axis === 'db') {
        if (!DB_ENGINES.includes(target as DbEngine)) {
          fail(state, `Usage: /switch db <${DB_ENGINES.join('|')}>`);
          return { state };
        }
        const engine = target as DbEngine;
        const spec = DB_ENGINE_SPECS[engine];
        if (!spec.availableOn.includes(infra.architecture)) {
          fail(state, `${spec.label} isn't available on ${infra.architecture}. Available: ${spec.availableOn.join(', ')}.`);
          return { state };
        }
        if (engine === infra.dbEngine) { fail(state, `Already running ${spec.label}.`); return { state }; }

        const cost = INFRA.subSwitch.costBase + infraCost(state) * INFRA.subSwitch.costMonthsOfInfra;
        const confirmed = (args[2] ?? '').toLowerCase() === 'confirm';
        if (!confirmed) {
          reply(state, `SWITCH ${DB_ENGINE_SPECS[infra.dbEngine].label.toUpperCase()} -> ${spec.label.toUpperCase()}`);
          reply(state, `  ${spec.description}`);
          reply(state, `  sp delta ${spec.spDelta >= 0 ? '+' : ''}${spec.spDelta}  ·  capacity x${spec.capacityMultiplier}  ·  cost x${spec.costMultiplier}`);
          reply(state, `  cost ${money(cost)}  ·  ${INFRA.subSwitch.days[0]}-${INFRA.subSwitch.days[1]} days at ${(INFRA.subSwitch.velocityPenalty * 100).toFixed(0)}% velocity`);
          reply(state, `  confirm with /switch db ${target} confirm`);
          return { state };
        }
        if (state.cash < cost) { fail(state, `Need ${money(cost)}; you have ${money(state.cash)}.`); return { state }; }
        state.cash -= cost;
        const days = Math.round((INFRA.subSwitch.days[0] + INFRA.subSwitch.days[1]) / 2);
        infra.pending = { kind: 'db', target: engine, daysLeft: days };
        pushEvent(state, 'alarm', `Switching database to ${spec.label}. ${money(cost)} charged. ${days} days at reduced velocity.`);
        return { state };
      }

      if (!RUNTIMES.includes(target as Runtime)) {
        fail(state, `Usage: /switch runtime <${RUNTIMES.join('|')}>`);
        return { state };
      }
      const runtime = target as Runtime;
      const spec = RUNTIME_SPECS[runtime];
      if (runtime === infra.runtime) { fail(state, `Already running ${spec.label}.`); return { state }; }

      const cost = INFRA.subSwitch.costBase + infraCost(state) * INFRA.subSwitch.costMonthsOfInfra;
      const confirmed = (args[2] ?? '').toLowerCase() === 'confirm';
      if (!confirmed) {
        reply(state, `SWITCH ${RUNTIME_SPECS[infra.runtime].label.toUpperCase()} -> ${spec.label.toUpperCase()}`);
        reply(state, `  ${spec.description}`);
        reply(state, `  sp delta ${spec.spDelta >= 0 ? '+' : ''}${spec.spDelta}  ·  capacity x${spec.capacityMultiplier}  ·  cost x${spec.costMultiplier}`);
        reply(state, `  cost ${money(cost)}  ·  ${INFRA.subSwitch.days[0]}-${INFRA.subSwitch.days[1]} days at ${(INFRA.subSwitch.velocityPenalty * 100).toFixed(0)}% velocity`);
        reply(state, `  confirm with /switch runtime ${target} confirm`);
        return { state };
      }
      if (state.cash < cost) { fail(state, `Need ${money(cost)}; you have ${money(state.cash)}.`); return { state }; }
      state.cash -= cost;
      const days = Math.round((INFRA.subSwitch.days[0] + INFRA.subSwitch.days[1]) / 2);
      infra.pending = { kind: 'compute', target: runtime, daysLeft: days };
      pushEvent(state, 'alarm', `Switching runtime to ${spec.label}. ${money(cost)} charged. ${days} days at reduced velocity.`);
      return { state };
    }

    case '/cache': {
      const action = (args[0] ?? '').toLowerCase();
      const cache = state.infra.cache;
      const tiers = INFRA.cache.tiers;

      if (action === 'buy' || action === 'upgrade') {
        const nextTier = cache.tier + 1;
        if (nextTier >= tiers.length) { fail(state, 'Already at the top cache tier.'); return { state }; }
        if (!cache.active && action === 'upgrade') { fail(state, 'No cache yet -- /cache buy first.'); return { state }; }
        const cost = tiers[nextTier].monthlyCost;
        cache.active = true;
        cache.tier = nextTier;
        cache.lastRefreshedDay = state.day;
        pushEvent(state, 'good', `Cache ${action === 'buy' ? 'purchased' : 'upgraded'} -- tier ${nextTier}, up to ${(tiers[nextTier].maxHitRate * 100).toFixed(0)}% hit rate, ${money(cost)}/mo.`);
        return { state };
      }
      if (action === 'refresh') {
        if (!cache.active) { fail(state, 'No cache to refresh. /cache buy first.'); return { state }; }
        cache.lastRefreshedDay = state.day;
        reply(state, `Cache refreshed. Hit rate will hold, then warm back toward ${(tiers[cache.tier].maxHitRate * 100).toFixed(0)}%.`);
        return { state };
      }
      reply(state, `CACHE  ${cache.active ? `tier ${cache.tier}, ${(cache.hitRate * 100).toFixed(0)}% hit rate` : 'not active'}`);
      reply(state, 'Usage: /cache buy | upgrade | refresh');
      return { state };
    }

    case '/promote': {
      const dev = resolveDeveloper(state, args[0] ?? '');
      if (!dev) { fail(state, `No developer "${args[0] ?? ''}".`); return { state }; }

      const next = nextLevel(dev.level);
      if (!next) { fail(state, `@${dev.handle} is already staff -- nothing higher to promote to.`); return { state }; }

      if (!isPromotable(dev)) {
        const top = topDiscipline(dev.proficiency);
        fail(state, `@${dev.handle} isn't ready -- ${top} proficiency ${Math.round(dev.proficiency[top])}, needs ${SIM.promotionThreshold[dev.level]}.`);
        return { state };
      }

      const ratio = SIM.baseSalary[next] / SIM.baseSalary[dev.level];
      const oldSalary = dev.salary;
      const oldLevel = dev.level;
      dev.level = next;
      dev.salary = Math.round((dev.salary * ratio) / 100) * 100;
      dev.morale = Math.min(100, dev.morale + SIM.promotionMoraleBoost);
      pushEvent(state, 'good', `@${dev.handle} promoted ${oldLevel} -> ${next}. Salary ${money(oldSalary)} -> ${money(dev.salary)}/mo.`);
      return { state };
    }

    case '/seed': {
      reply(state, `Run seed ${state.rng.seed}, day ${state.day}. Same seed replays the same run.`);
      return { state };
    }

    case '/ticket': {
      const t = resolveTicket(state, args[0] ?? '');
      if (!t) { fail(state, `No ticket "${args[0] ?? ''}". Try /board.`); return { state }; }
      const dev = t.assignedTo ? state.developers.find((d) => d.id === t.assignedTo) : null;
      reply(state, `#${t.handle}  ${t.title}`);
      reply(state, `  ${TYPE_LABEL[t.type].trim()} / ${effectiveSeverity(t)}${t.escalationLevel > 0 ? ` (escalated ^${t.escalationLevel})` : ''} / ${t.discipline}   ${t.storyPoints}sp`);
      reply(state, `  ${t.description}`);
      if (t.type === 'feature') reply(state, `  ships +${money(t.revenue)}/mo MRR`);
      if (t.type === 'bug') reply(state, `  raising churn by ${pct(SIM.bugChurnWeight[t.severity] * stageAt(state.stageIndex).baseChurn)}/mo while open`);
      if (t.type === 'tech_debt') reply(state, `  dragging team velocity while open`);
      if (dev) {
        const eta = daysRemaining(dev, t, velocityMultiplier(state));
        reply(state, `  @${dev.handle} ${bar(t.progressPoints / t.storyPoints)} ${t.progressPoints.toFixed(1)}/${t.storyPoints}sp  ${eta === null ? 'stalled' : `~${eta}d left`}`);
      } else if (isOpen(t)) {
        reply(state, `  unassigned -- /assign @someone #${t.handle}`);
      }
      return { state };
    }

    case '/dev': {
      const d = resolveDeveloper(state, args[0] ?? '');
      if (!d) { fail(state, `No developer "${args[0] ?? ''}". Try /team.`); return { state }; }
      reply(state, `@${d.handle}  ${d.name}  ${d.level}  ${money(d.salary)}/mo  joined day ${d.joinedDay}`);
      reply(state, `  morale ${bar(d.morale / 100)} ${Math.round(d.morale)}${d.noticeDaysLeft !== null ? `   NOTICE: leaves in ${d.noticeDaysLeft}d` : ''}`);
      for (const disc of DISCIPLINES) {
        reply(state, `  ${pad(disc, 10)}${bar(d.proficiency[disc] / 100)} ${Math.round(d.proficiency[disc])}`);
      }
      return { state };
    }

    case '/assign': {
      const dev = resolveDeveloper(state, args[0] ?? '');
      const ticket = resolveTicket(state, args[1] ?? '');
      if (!dev) { fail(state, `No developer "${args[0] ?? ''}". Usage: /assign @dev #ticket`); return { state }; }
      if (!ticket) { fail(state, `No ticket "${args[1] ?? ''}". Usage: /assign @dev #ticket`); return { state }; }
      if (ticket.status === 'done') { fail(state, `#${ticket.handle} is already done.`); return { state }; }

      const incumbent = state.developers.find((d) => d.currentTicketId === ticket.id);
      if (incumbent && incumbent.id !== dev.id) {
        incumbent.currentTicketId = null;
        reply(state, `@${incumbent.handle} came off #${ticket.handle}.`);
      }
      release(state, dev);

      dev.currentTicketId = ticket.id;
      ticket.assignedTo = dev.id;
      ticket.status = 'in_progress';

      const v = effectiveVelocity(dev, ticket, velocityMultiplier(state));
      const eta = daysRemaining(dev, ticket, velocityMultiplier(state));
      reply(state, `@${dev.handle} -> #${ticket.handle} "${ticket.title}"`);
      reply(state, `  ${ticket.discipline} ${Math.round(dev.proficiency[ticket.discipline])}, ${v.toFixed(2)} sp/day, ${eta === null ? 'stalled' : `~${eta} days`}`);
      return { state };
    }

    case '/auto': {
      const mode = (args[0] ?? '').toLowerCase();

      if (mode === 'off') {
        state.autoAssign = false;
        reply(state, 'Auto-assign OFF. Developers will idle until you /assign them.');
        return { state };
      }
      if (mode && mode !== 'once' && mode !== 'on') {
        fail(state, `Unknown option "${mode}". Usage: /auto [off | once]`);
        return { state };
      }

      // Bare /auto (and /auto on) leaves the mode running; /auto once does not.
      if (mode !== 'once') state.autoAssign = true;

      const idle = idleDevelopers(state);
      if (idle.length === 0) {
        reply(state, `Everyone is already working.${state.autoAssign ? ' Auto-assign ON.' : ''}`);
        return { state };
      }

      const plan = planAssignments(state, idle);
      if (plan.length === 0) {
        reply(
          state,
          `Nothing to assign -- ${idle.length} idle, no open unclaimed tickets.${state.autoAssign ? ' Auto-assign ON; they will be picked up as work arrives.' : ''}`,
        );
        return { state };
      }

      for (const { developer, ticket, value, days } of plan) {
        const dev = state.developers.find((d) => d.id === developer.id)!;
        const target = state.tickets.find((t) => t.id === ticket.id)!;
        dev.currentTicketId = target.id;
        target.assignedTo = dev.id;
        target.status = 'in_progress';

        reply(state, `  @${pad(dev.handle, 10)}-> #${pad(target.handle, 4)} ${TYPE_LABEL[target.type]} ${target.title}`);
        reply(state, `  ${' '.repeat(10)}   ${target.discipline} ${Math.round(dev.proficiency[target.discipline])} · ${money(value)}/day · ~${days}d`);
      }

      const stillIdle = idle.length - plan.length;
      const tail = state.autoAssign
        ? 'Auto-assign ON -- /auto off to stop.'
        : 'Override with /assign.';
      reply(
        state,
        `${plan.length} assigned${stillIdle > 0 ? `, ${stillIdle} idle (no work left)` : ''}. ${tail}`,
      );
      return { state };
    }

    case '/unassign': {
      const dev = resolveDeveloper(state, args[0] ?? '');
      if (!dev) { fail(state, `No developer "${args[0] ?? ''}".`); return { state }; }
      if (!dev.currentTicketId) { reply(state, `@${dev.handle} is already idle.`); return { state }; }
      release(state, dev);
      reply(state, `@${dev.handle} is now idle.`);
      return { state };
    }

    case '/hire': {
      if (args.length === 0) {
        if (state.candidates.length === 0) { reply(state, 'No candidates right now.'); return { state }; }
        reply(state, `CANDIDATES  ${state.candidates.length}`);
        for (const c of state.candidates) {
          const top = topDiscipline(c.proficiency);
          reply(state, `  @${pad(c.handle, 10)}${pad(c.level, 7)}${pad(top, 9)}${padL(String(c.proficiency[top]), 3)}  ${padL(money(c.salary), 8)}/mo  fee ${money(c.salary * SIM.hiringFeeMonths)}  ${c.expiresDay - state.day}d left`);
          reply(state, `             ${c.blurb}`);
        }
        return { state };
      }
      const c = resolveCandidate(state, args[0]);
      if (!c) { fail(state, `No candidate "${args[0]}". Try /hire with no arguments.`); return { state }; }
      const fee = c.salary * SIM.hiringFeeMonths;
      if (state.cash < fee) { fail(state, `Need ${money(fee)} for the recruiter fee; you have ${money(state.cash)}.`); return { state }; }

      state.cash -= fee;
      state.candidates = state.candidates.filter((x) => x.id !== c.id);
      const dev = hireCandidate(state, c);
      state.developers.push(dev);
      pushEvent(state, 'good', `Hired @${dev.handle} -- ${dev.level}, ${money(dev.salary)}/mo. Fee ${money(fee)}.`);
      return { state };
    }

    case '/fire': {
      const dev = resolveDeveloper(state, args[0] ?? '');
      if (!dev) { fail(state, `No developer "${args[0] ?? ''}".`); return { state }; }
      const severance = dev.salary * SIM.severanceMonths;
      release(state, dev);
      state.developers = state.developers.filter((d) => d.id !== dev.id);
      state.cash -= severance;
      pushEvent(state, 'warn', `Let @${dev.handle} go. Severance ${money(severance)}.`);
      return { state };
    }

    case '/raise':
    case '/bonus': {
      const dev = resolveDeveloper(state, args[0] ?? '');
      const amount = Number(args[1]);
      if (!dev) { fail(state, `No developer "${args[0] ?? ''}". Usage: ${name} @dev <amount>`); return { state }; }
      if (!Number.isFinite(amount) || amount <= 0) { fail(state, `Usage: ${name} @dev <amount>`); return { state }; }

      if (name === '/raise') {
        dev.salary += amount;
        applyMoraleSpend(state, dev, (amount / 1000) * SIM.moralePerRaiseK, 'raise');
        reply(state, `@${dev.handle} raised to ${money(dev.salary)}/mo. Morale ${Math.round(dev.morale)}.`);
      } else {
        if (state.cash < amount) { fail(state, `Only ${money(state.cash)} on hand.`); return { state }; }
        state.cash -= amount;
        applyMoraleSpend(state, dev, (amount / 1000) * SIM.moralePerBonusK, 'bonus');
        reply(state, `Paid @${dev.handle} ${money(amount)}. Morale ${Math.round(dev.morale)}.`);
      }
      return { state };
    }

    case '/speed': {
      const v = Number(args[0]);
      if (![0, 1, 2, 4].includes(v)) { fail(state, 'Usage: /speed 0|1|2|4'); return { state }; }
      state.speed = v;
      state.status = v === 0 ? 'paused' : 'running';
      reply(state, v === 0 ? 'Paused.' : `Speed ${v}x.`);
      return { state };
    }

    case '/pause': {
      state.speed = 0;
      if (state.status === 'running') state.status = 'paused';
      reply(state, 'Paused.');
      return { state };
    }

    case '/resume': {
      if (state.status === 'won' || state.status === 'lost') { fail(state, 'This run is over. /restart'); return { state }; }
      state.speed = state.speed || 1;
      state.status = 'running';
      reply(state, `Running at ${state.speed}x.`);
      return { state };
    }

    case '/save': {
      const slot = args.join(' ').trim();
      if (!slot) { fail(state, 'Usage: /save <name>'); return { state }; }
      return { state, effect: { kind: 'save', name: slot } };
    }

    case '/load': {
      const slot = args.join(' ').trim();
      if (!slot) { fail(state, 'Usage: /load <name>. /saves to list.'); return { state }; }
      return { state, effect: { kind: 'load', name: slot } };
    }

    case '/saves':
      return { state, effect: { kind: 'list_saves' } };

    case '/restart':
      return { state, effect: { kind: 'restart' } };

    default:
      fail(state, `Unknown command "${name}". /help for the list.`);
      return { state };
  }
}
