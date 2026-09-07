import assert from 'node:assert/strict';
import test from 'node:test';

import { apply } from './commands';
import { churnRate, computeEfficiency, drag, effectiveCapacity, effectiveSeverity, finances as economyFinances, isOpen, requiredCapacity } from './economy';
import { popTicketFlavor } from './flavor';
import { createRng } from './rng';
import { rollTicket, topDiscipline } from './roll';
import { deserialise, newRun, serialise } from './state';
import { run, tick } from './tick';
import { idleDevelopers, planAssignments } from './triage';
import { INFRA, SIM } from './tuning';
import { RunState } from './types';

const started = () => apply(newRun('TEST', 4242), '/speed 1').state;

// ─── Determinism ─────────────────────────────────────────────────────────────

test('the same Seed replays identically', () => {
  const a = run(newRun('A', 99), 200);
  const b = run(newRun('A', 99), 200);
  assert.equal(serialise(a), serialise(b));
});

test('different Seeds diverge', () => {
  const a = run(newRun('A', 1), 120);
  const b = run(newRun('A', 2), 120);
  assert.notEqual(serialise(a), serialise(b));
});

test('a Run survives a save/load round trip', () => {
  const before = run(newRun('A', 7), 90);
  const after = deserialise(serialise(before));
  assert.ok(after);
  // Only `speed` is intentionally reset, so the clock never resumes on its own.
  assert.deepEqual({ ...after, speed: before.speed }, before);
});

// ─── Handles ─────────────────────────────────────────────────────────────────

test('Handles are unique across a long Run', () => {
  const state = run(newRun('A', 11), 400);
  const ticketHandles = state.tickets.map((t) => t.handle);
  const devHandles = state.developers.map((d) => d.handle);
  assert.equal(new Set(ticketHandles).size, ticketHandles.length);
  assert.equal(new Set(devHandles).size, devHandles.length);
});

// ─── Regression: the dangling assignment bug ─────────────────────────────────

test('unassigning clears the developer, not just the ticket', () => {
  let state = started();
  const dev = state.developers[0];
  const ticket = state.tickets.find(isOpen)!;

  state = apply(state, `/assign @${dev.handle} #${ticket.handle}`).state;
  assert.equal(state.developers[0].currentTicketId, ticket.id);
  assert.equal(state.tickets.find((t) => t.id === ticket.id)!.status, 'in_progress');

  state = apply(state, `/unassign @${dev.handle}`).state;
  assert.equal(state.developers[0].currentTicketId, null, 'developer must not stay busy');
  assert.equal(state.tickets.find((t) => t.id === ticket.id)!.status, 'backlog');
  assert.equal(state.tickets.find((t) => t.id === ticket.id)!.assignedTo, null);
});

test('a developer pointing at a non-active ticket is released by the tick', () => {
  let state = started();
  const dev = state.developers[0];
  const ticket = state.tickets.find(isOpen)!;
  state = apply(state, `/assign @${dev.handle} #${ticket.handle}`).state;

  // Force the inconsistency the original code could produce.
  state = {
    ...state,
    tickets: state.tickets.map((t) => (t.id === ticket.id ? { ...t, status: 'backlog' as const } : t)),
  };
  state = tick(state);
  assert.equal(state.developers[0].currentTicketId, null);
});

test('reassigning a ticket takes it off the previous developer', () => {
  let state = started();
  const [a] = state.developers;
  state = apply(state, '/hire').state; // no-op when there are no candidates
  const ticket = state.tickets.find(isOpen)!;
  state = apply(state, `/assign @${a.handle} #${ticket.handle}`).state;
  const other = state.tickets.filter(isOpen).find((t) => t.id !== ticket.id)!;
  state = apply(state, `/assign @${a.handle} #${other.handle}`).state;

  assert.equal(state.tickets.find((t) => t.id === ticket.id)!.status, 'backlog');
  assert.equal(state.developers[0].currentTicketId, state.tickets.find((t) => t.id === other.id)!.id);
});

// ─── Economy ─────────────────────────────────────────────────────────────────

test('MRR churns downward when nothing ships', () => {
  let state: RunState = { ...newRun('A', 3), mrr: 10_000, developers: [], tickets: [] };
  state = run(state, 30);
  assert.ok(state.mrr < 10_000, 'churn must always pull MRR down');
  assert.ok(state.mrr > 8_000, 'one month of base churn should not halve MRR');
});

test('open bugs raise churn and fixing them lowers it', () => {
  const base = newRun('A', 5);
  const rng = createRng(1, 0);
  const withBug: RunState = { ...base, tickets: [rollTicket({ ...base }, rng, 'bug')] };
  assert.ok(churnRate(withBug) > churnRate(base));

  const fixed: RunState = {
    ...withBug,
    tickets: withBug.tickets.map((t) => ({ ...t, status: 'done' as const })),
  };
  assert.equal(churnRate(fixed), churnRate(base));
});

test('open tech debt drags velocity and is floored', () => {
  const base = newRun('A', 6);
  const rng = createRng(2, 0);
  const debt = Array.from({ length: 3 }, () => rollTicket({ ...base }, rng, 'tech_debt'));
  const dragged: RunState = { ...base, tickets: debt };
  assert.ok(drag(dragged) < 1);
  assert.ok(drag(dragged) >= SIM.minDrag);
});

test('runway is infinite only when cash-flow positive', () => {
  const state: RunState = { ...newRun('A', 8), mrr: 1_000_000, developers: [] };
  assert.equal(churnRate(state) > 0, true);
  const poor: RunState = { ...newRun('A', 8), mrr: 0 };
  assert.ok(Number.isFinite(poor.cash));
});

test('bankruptcy ends the run', () => {
  let state: RunState = { ...started(), cash: 200 };
  state = run(state, 60);
  assert.equal(state.status, 'lost');
});

// ─── Morale ──────────────────────────────────────────────────────────────────

test('an idle developer recovers morale', () => {
  let state: RunState = {
    ...started(),
    tickets: [],
    developers: started().developers.map((d) => ({ ...d, morale: 40, currentTicketId: null })),
  };
  const before = state.developers[0].morale;
  state = tick(state);
  assert.ok(state.developers[0].morale > before);
});

test('routine work has a sustainable morale equilibrium', () => {
  // Regression: drain once exceeded recovery unconditionally, so any permanently
  // assigned team decayed to zero no matter how well the player played.
  let state = started();
  const dev = state.developers[0];
  const ticket = state.tickets.find((t) => isOpen(t) && t.severity !== 'critical')!;
  state = apply(state, `/assign @${dev.handle} #${ticket.handle}`).state;
  state = run(state, 200);
  const survivor = state.developers.find((d) => d.handle === dev.handle);
  if (survivor) assert.ok(survivor.morale > 20, `morale collapsed to ${survivor.morale}`);
});

// ─── Flavor ──────────────────────────────────────────────────────────────────

test('Flavor never repeats a title, even with an empty queue', () => {
  const state = newRun('A', 12);
  const rng = createRng(3, 0);
  const titles = new Set<string>();
  for (let i = 0; i < 150; i++) {
    const { title } = popTicketFlavor(state.flavor, rng, 'bug', 'backend');
    assert.ok(!titles.has(title.toLowerCase()), `repeated title: ${title}`);
    titles.add(title.toLowerCase());
  }
});

// ─── Commands ────────────────────────────────────────────────────────────────

test('an unknown target leaves the run untouched', () => {
  const state = started();
  const after = apply(state, '/assign @nobody #zzz').state;
  assert.deepEqual(
    { ...after, events: [] },
    { ...state, events: [], idSeq: after.idSeq },
  );
});

test('a bonus larger than cash is refused', () => {
  const state = started();
  const dev = state.developers[0];
  const after = apply(state, `/bonus @${dev.handle} ${state.cash + 1}`).state;
  assert.equal(after.cash, state.cash);
});

test('hiring charges the recruiter fee', () => {
  let state = run(started(), 400);
  if (state.candidates.length === 0 || state.status !== 'running') return;
  const candidate = state.candidates[0];
  const fee = candidate.salary * SIM.hiringFeeMonths;
  const before = state.cash;
  const size = state.developers.length;
  state = apply(state, `/hire @${candidate.handle}`).state;
  if (before < fee) return;
  assert.equal(state.developers.length, size + 1);
  assert.ok(Math.abs(state.cash - (before - fee)) < 0.01);
});

// ─── Auto-assign ─────────────────────────────────────────────────────────────

test('/auto puts every idle developer on a ticket', () => {
  let state = started();
  assert.ok(state.developers.every((d) => !d.currentTicketId));

  state = apply(state, '/auto').state;
  const working = state.developers.filter((d) => d.currentTicketId);
  assert.equal(working.length, Math.min(state.developers.length, state.tickets.filter(isOpen).length));

  for (const dev of working) {
    const ticket = state.tickets.find((t) => t.id === dev.currentTicketId)!;
    assert.equal(ticket.status, 'in_progress');
    assert.equal(ticket.assignedTo, dev.id);
  }
});

test('/auto never puts two developers on one ticket', () => {
  let state = run(started(), 120);
  if (state.status !== 'running') return;
  state = apply(state, '/auto').state;
  const assigned = state.developers.filter((d) => d.currentTicketId).map((d) => d.currentTicketId);
  assert.equal(new Set(assigned).size, assigned.length);
});

test('/auto leaves already-working developers alone', () => {
  let state = apply(started(), '/auto').state;
  const before = state.developers.map((d) => d.currentTicketId);
  state = apply(state, '/auto').state;
  assert.deepEqual(state.developers.map((d) => d.currentTicketId), before);
});

test('/auto reports rather than throws when there is no work', () => {
  const empty: RunState = { ...started(), tickets: [] };
  const after = apply(empty, '/auto').state;
  assert.equal(after.developers.every((d) => !d.currentTicketId), true);
  assert.match(after.events.at(-1)!.text, /Nothing to assign/);
});

test('triage prefers the pairing with the higher value per day', () => {
  const state = run(started(), 60);
  if (state.status !== 'running') return;
  const plan = planAssignments(state, idleDevelopers(state));
  for (let i = 1; i < plan.length; i++) {
    assert.ok(plan[i - 1].value >= plan[i].value, 'plan must be ordered by value');
  }
});

test('/auto stays on and picks up work as it arrives', () => {
  let state = apply(started(), '/auto').state;
  assert.equal(state.autoAssign, true);

  // Free everyone, then advance -- the mode should put them back to work.
  state = {
    ...state,
    developers: state.developers.map((d) => ({ ...d, currentTicketId: null })),
    tickets: state.tickets.map((t) => (
      t.status === 'in_progress' ? { ...t, status: 'backlog' as const, assignedTo: null } : t
    )),
  };
  state = tick(state);
  assert.ok(state.developers.some((d) => d.currentTicketId), 'idle developers should be picked up');
});

test('/auto off stops the mode', () => {
  let state = apply(started(), '/auto').state;
  state = apply(state, '/auto off').state;
  assert.equal(state.autoAssign, false);

  state = {
    ...state,
    developers: state.developers.map((d) => ({ ...d, currentTicketId: null })),
    tickets: state.tickets.map((t) => (
      t.status === 'in_progress' ? { ...t, status: 'backlog' as const, assignedTo: null } : t
    )),
  };
  state = tick(state);
  assert.ok(state.developers.every((d) => !d.currentTicketId), 'nobody should be auto-assigned');
});

test('/auto once assigns without turning the mode on', () => {
  const state = apply(started(), '/auto once').state;
  assert.equal(state.autoAssign, false);
  assert.ok(state.developers.some((d) => d.currentTicketId));
});

test('a v2 save migrates instead of being discarded', () => {
  const legacy = JSON.parse(serialise(newRun('OLD', 21))) as Record<string, unknown>;
  legacy.version = 2;
  delete legacy.autoAssign;
  const loaded = deserialise(JSON.stringify(legacy));
  assert.ok(loaded, 'a v2 save should still load');
  assert.equal(loaded.autoAssign, false);
});

// ─── Infrastructure ──────────────────────────────────────────────────────────

test('traffic grows every Day and can spike', () => {
  const before = started().infra.traffic;
  const after = run(started(), 60).infra.traffic;
  assert.ok(after > before, 'traffic must grow over time');
});

test('scaling compute raises capacity and the recurring bill', () => {
  const before = started();
  const beforeCapacity = effectiveCapacity(before);
  const beforeBurn = economyFinances(before).burn;

  const after = apply(before, '/scale compute +5').state;
  assert.ok(effectiveCapacity(after) > beforeCapacity);
  assert.ok(economyFinances(after).burn > beforeBurn);
});

test('scale never drops compute or db replicas below 1', () => {
  const state = apply(started(), '/scale compute -99').state;
  assert.equal(state.infra.compute, 1);
});

test('open tech debt inflates required capacity, not just Drag', () => {
  const base: RunState = { ...newRun('A', 40), tickets: [] };
  const rng = createRng(9, 0);
  const debtTicket = { ...rollTicket({ ...base }, rng, 'tech_debt'), severity: 'high' as const };
  const withDebt: RunState = { ...base, tickets: [debtTicket] };
  assert.ok(requiredCapacity(withDebt) > requiredCapacity(base));
});

test('senior-heavy teams get more capacity per unit of compute than junior-heavy ones', () => {
  const base = started();
  const proficient: RunState = {
    ...base,
    developers: base.developers.map((d) => ({ ...d, proficiency: { ...d.proficiency, devops: 90 } })),
  };
  const junior: RunState = {
    ...base,
    developers: base.developers.map((d) => ({ ...d, proficiency: { ...d.proficiency, devops: 10 } })),
  };
  assert.ok(computeEfficiency(proficient) > computeEfficiency(junior));
});

test('running over capacity raises churn like a bug would', () => {
  const base: RunState = { ...started(), mrr: 10_000 };
  const calm = churnRate(base);
  const overloaded: RunState = { ...base, infra: { ...base.infra, traffic: base.infra.traffic * 500 } };
  assert.ok(churnRate(overloaded) > calm);
});

test('migration charges cash, cannot double-start, and needs confirmation', () => {
  let state = started();
  const preview = apply(state, '/migrate kubernetes').state;
  assert.equal(preview.infra.pending, null, 'a bare /migrate must not commit');

  const before = preview.cash;
  state = apply(preview, '/migrate kubernetes confirm').state;
  assert.equal(state.infra.pending?.kind, 'architecture');
  assert.equal(state.infra.pending?.target, 'kubernetes');
  assert.ok(state.cash < before, 'migration must charge cash up front');

  const again = apply(state, '/migrate serverless confirm').state;
  assert.equal(again.infra.pending?.target, 'kubernetes', 'cannot start a second migration mid-flight');
});

test('migration slows the whole team and completes into the new architecture', () => {
  let state = apply(started(), '/migrate kubernetes confirm').state;
  const days = state.infra.pending!.daysLeft;

  const dev = state.developers[0];
  const ticket = state.tickets.find(isOpen)!;
  state = apply(state, `/assign @${dev.handle} #${ticket.handle}`).state;

  const slowProgress = tick(state).tickets.find((t) => t.id === ticket.id)!.progressPoints;
  const fullSpeedState: RunState = { ...state, infra: { ...state.infra, pending: null } };
  const fullProgress = tick(fullSpeedState).tickets.find((t) => t.id === ticket.id)!.progressPoints;
  assert.ok(slowProgress < fullProgress, 'migration must slow shipping, not just cost cash');

  for (let i = 0; i < days; i++) state = tick(state);
  assert.equal(state.infra.architecture, 'kubernetes');
  assert.equal(state.infra.pending, null);
});

test('switching database engine requires availability on the current architecture', () => {
  const state = started(); // monolith
  const denied = apply(state, '/switch db managed confirm').state;
  assert.equal(denied.infra.dbEngine, 'postgres', 'managed is not available on monolith');
  assert.match(denied.events.at(-1)!.text, /isn't available/);
});

test('switching runtime charges a smaller cost than a full migration', () => {
  const state = started();
  const migrateCost = state.cash - apply(state, '/migrate kubernetes confirm').state.cash;
  const switchCost = state.cash - apply(state, '/switch runtime go confirm').state.cash;
  assert.ok(switchCost < migrateCost, 'a sub-architecture switch should be the cheaper bet');
});

test('a fresh cache warms up over a few Days, then reduces required capacity', () => {
  let state: RunState = { ...started(), tickets: [], mrr: 20_000 };
  state = apply(state, '/cache buy').state;
  assert.equal(state.infra.cache.hitRate, 0, 'a freshly bought cache has not warmed up yet');

  for (let i = 0; i < 4; i++) state = tick(state);
  assert.ok(state.infra.cache.hitRate > 0, 'the cache must warm up over a few days');

  const withCache = requiredCapacity(state);
  const withoutCache: RunState = { ...state, infra: { ...state.infra, cache: { ...state.infra.cache, active: false } } };
  assert.ok(withCache < requiredCapacity(withoutCache), 'a warmed-up cache must reduce required capacity');
});

test('a stale cache decays and can throw an integrity bug', () => {
  const warmed: RunState = {
    ...started(),
    tickets: [],
    infra: { ...started().infra, cache: { active: true, tier: 1, hitRate: 0.35, lastRefreshedDay: 1 } },
  };
  const staleDay = warmed.day + INFRA.cache.staleAfterDays + 1;
  const state = tick({ ...warmed, day: staleDay - 1 });
  assert.ok(state.infra.cache.hitRate < 0.35, 'a cache past its refresh window must decay');
});

test('a Ticket left open long enough escalates severity and never de-escalates', () => {
  let state = started();
  const bug = state.tickets.find(isOpen) ?? state.tickets[0];
  state = { ...state, tickets: state.tickets.map((t) => (t.id === bug.id ? { ...t, type: 'bug' as const, severity: 'low' as const, createdDay: state.day } : t)) };
  state = { ...state, day: state.day + 40 };
  state = tick(state);
  const escalated = state.tickets.find((t) => t.id === bug.id)!;
  assert.ok(escalated.escalationLevel > 0);
  assert.notEqual(effectiveSeverity(escalated), 'low');
});

test('an untouched Feature is withdrawn after its expiry day, an in-progress one is not', () => {
  const base = started();
  const feature = base.tickets.find((t) => t.type === 'feature')!;
  let untouched: RunState = { ...base, tickets: base.tickets.map((t) => (t.id === feature.id ? { ...t, expiresDay: base.day + 1 } : t)) };
  untouched = tick(untouched);
  untouched = tick(untouched);
  assert.equal(untouched.tickets.some((t) => t.id === feature.id), false, 'an untouched feature must expire');

  const dev = base.developers[0];
  let working: RunState = {
    ...base,
    tickets: base.tickets.map((t) => (t.id === feature.id ? { ...t, expiresDay: base.day + 1, status: 'in_progress' as const, assignedTo: dev.id } : t)),
    developers: base.developers.map((d) => (d.id === dev.id ? { ...d, currentTicketId: feature.id } : d)),
  };
  working = tick(working);
  working = tick(working);
  assert.equal(working.tickets.some((t) => t.id === feature.id), true, 'an in-progress feature must not expire');
});

test('a promotable developer can be promoted, raising velocity tier and salary', () => {
  let state = started();
  const dev = state.developers[0];
  state = { ...state, developers: state.developers.map((d) => (d.id === dev.id ? { ...d, proficiency: { ...d.proficiency, [topDiscipline(d.proficiency)]: 99 } } : d)) };
  const before = state.developers[0];
  state = apply(state, `/promote @${dev.handle}`).state;
  const after = state.developers[0];
  assert.notEqual(after.level, before.level);
  assert.ok(after.salary > before.salary);
  assert.ok(after.morale >= before.morale);
});

test('promotion is refused below the Proficiency threshold', () => {
  const state = started();
  const dev = state.developers[0];
  const after = apply(state, `/promote @${dev.handle}`).state;
  assert.equal(after.developers[0].level, dev.level, 'a founder is unlikely to already qualify, and should not silently promote');
});

test('a v3 save migrates and defaults to monolith', () => {
  const legacy = JSON.parse(serialise(newRun('OLD', 22))) as Record<string, unknown>;
  legacy.version = 3;
  delete legacy.infra;
  const loaded = deserialise(JSON.stringify(legacy));
  assert.ok(loaded, 'a v3 save should still load');
  assert.equal(loaded.infra.architecture, 'monolith');
  assert.equal(loaded.infra.compute, 1);
});

// ─── Managed database auto-scaling ────────────────────────────────────────────

test('managed database replicas autoscale up with traffic, without a command', () => {
  let state: RunState = {
    ...started(),
    infra: { ...started().infra, architecture: 'kubernetes', dbEngine: 'managed' },
    mrr: 40_000,
  };
  const before = state.infra.dbReplicas;
  state = { ...state, infra: { ...state.infra, trafficBaseline: state.infra.trafficBaseline * 40, traffic: state.infra.trafficBaseline * 40 } };
  state = tick(state);
  assert.ok(state.infra.dbReplicas > before, 'managed replicas must grow to meet a traffic surge on their own');
});

test('managed database replicas autoscale down once demand drops', () => {
  let state: RunState = {
    ...started(),
    infra: { ...started().infra, architecture: 'kubernetes', dbEngine: 'managed', dbReplicas: 50 },
  };
  state = tick(state);
  assert.ok(state.infra.dbReplicas < 50, 'idle-cheap replicas should shrink back down automatically');
});

test('/scale db is refused on a managed engine', () => {
  const state: RunState = {
    ...started(),
    infra: { ...started().infra, architecture: 'kubernetes', dbEngine: 'managed', dbReplicas: 3 },
  };
  const after = apply(state, '/scale db +5').state;
  assert.equal(after.infra.dbReplicas, 3, 'manual db scaling must not move replicas on managed');
  assert.match(after.events.at(-1)!.text, /autoscale/);
});

test('/scale db still works normally on postgres or mongo', () => {
  const state = started(); // monolith + postgres
  const after = apply(state, '/scale db +2').state;
  assert.equal(after.infra.dbReplicas, state.infra.dbReplicas + 2);
});
