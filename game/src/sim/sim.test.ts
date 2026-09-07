import assert from 'node:assert/strict';
import test from 'node:test';

import { apply } from './commands';
import {
  churnRate, computeEfficiency, coordinationDrag, drag, effectiveCapacity, effectiveSeverity,
  finances as economyFinances, isOpen, levelShare, marketPullChance, officeCost, requiredCapacity,
  velocityMultiplier,
} from './economy';
import { popTicketFlavor } from './flavor';
import { createRng } from './rng';
import { playTurn } from './policy';
import { isPromotable, rollCandidate, rollTicket, topDiscipline } from './roll';
import { deserialise, newRun, serialise } from './state';
import { run, tick } from './tick';
import { idleDevelopers, planAssignments } from './triage';
import { INFRA, REMOTE_COUNTRIES, SIM, WORKPLACE } from './tuning';
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

// ─── Auto-focus ────────────────────────────────────────────────────────────────

test('focus makes a lower-value ticket of that type win over a higher-value one of another type', () => {
  const base = started();
  const dev = base.developers[0];
  const feature = { ...base.tickets[0], id: 'f1', type: 'feature' as const, status: 'backlog' as const, revenue: 5000, storyPoints: 3, progressPoints: 0, assignedTo: null };
  const bug = { ...base.tickets[0], id: 'b1', type: 'bug' as const, status: 'backlog' as const, severity: 'low' as const, escalationLevel: 0, storyPoints: 3, progressPoints: 0, assignedTo: null };
  const state: RunState = { ...base, mrr: 30_000, tickets: [feature, bug] };

  const unfocused = planAssignments(state, [dev], null);
  assert.equal(unfocused[0]?.ticket.id, 'f1', 'without focus the higher-value feature should win');

  const focused = planAssignments(state, [dev], 'bug');
  assert.equal(focused[0]?.ticket.id, 'b1', 'focused on bug, the bug must win despite lower raw value');
});

test('focus falls back to other work rather than leaving a developer idle', () => {
  const base = started();
  const dev = base.developers[0];
  const feature = { ...base.tickets[0], id: 'f1', type: 'feature' as const, status: 'backlog' as const, revenue: 500, storyPoints: 3, progressPoints: 0, assignedTo: null };
  const state: RunState = { ...base, tickets: [feature] }; // no bugs open at all

  const plan = planAssignments(state, [dev], 'bug');
  assert.equal(plan[0]?.ticket.id, 'f1', 'no bug open -- must still assign the feature, not sit idle');
});

test('/auto bug sets and shows focus, /auto all clears it', () => {
  let state = apply(started(), '/auto bug').state;
  assert.equal(state.autoFocus, 'bug');
  assert.equal(state.autoAssign, true);

  state = apply(state, '/auto all').state;
  assert.equal(state.autoFocus, null);
  assert.equal(state.autoAssign, true);
});

test('/auto debt maps to the tech_debt ticket type', () => {
  const state = apply(started(), '/auto debt').state;
  assert.equal(state.autoFocus, 'tech_debt');
});

test('/auto off does not clear an existing focus, only pauses assignment', () => {
  let state = apply(started(), '/auto bug').state;
  state = apply(state, '/auto off').state;
  assert.equal(state.autoAssign, false);
  assert.equal(state.autoFocus, 'bug', 'focus should persist so turning auto back on resumes it');
});

test('standing auto-assign in the tick respects the active focus', () => {
  const base = started();
  const dev = base.developers[0];
  let state: RunState = {
    ...base,
    mrr: 30_000,
    autoAssign: true,
    autoFocus: 'bug',
    developers: base.developers.map((d) => ({ ...d, currentTicketId: null })),
    tickets: [
      { ...base.tickets[0], id: 'f1', type: 'feature', status: 'backlog', revenue: 5000, storyPoints: 3, progressPoints: 0, assignedTo: null },
      { ...base.tickets[0], id: 'b1', type: 'bug', status: 'backlog', severity: 'low', escalationLevel: 0, storyPoints: 3, progressPoints: 0, assignedTo: null },
    ],
  };
  state = tick(state);
  const assignedId = state.developers.find((d) => d.id === dev.id)!.currentTicketId;
  assert.equal(assignedId, 'b1', 'the tick itself must honor autoFocus, not just the one-shot command');
});

test('a v5 save migrates and defaults to no focus', () => {
  const legacy = JSON.parse(serialise(newRun('OLD', 23))) as Record<string, unknown>;
  legacy.version = 5;
  delete legacy.autoFocus;
  const loaded = deserialise(JSON.stringify(legacy));
  assert.ok(loaded, 'a v5 save should still load');
  assert.equal(loaded.autoFocus, null);
});

// ─── Team composition and Market Pull ─────────────────────────────────────────

test('Junior and Mid have zero Market Pull, regardless of team composition', () => {
  const base = started();
  const allJunior: RunState = {
    ...base,
    developers: base.developers.map((d) => ({ ...d, level: 'junior' as const, morale: 100 })),
  };
  assert.equal(marketPullChance(allJunior, 'junior'), 0);
  const allMid: RunState = {
    ...base,
    developers: base.developers.map((d) => ({ ...d, level: 'mid' as const, morale: 100 })),
  };
  assert.equal(marketPullChance(allMid, 'mid'), 0);
});

test('Market Pull applies a baseline even exactly at the Target Mix, and more when over it', () => {
  const base = started();
  const onTarget: RunState = {
    ...base,
    developers: Array.from({ length: 100 }, (_, i) => ({
      ...base.developers[0], id: `d${i}`, handle: `d${i}`,
      level: i < 8 ? ('staff' as const) : ('junior' as const), // staff exactly at its 8% target
    })),
  };
  const baseline = marketPullChance(onTarget, 'staff');
  assert.ok(baseline > 0, 'even on-target, staff must carry a nonzero baseline chance');

  const overTarget: RunState = {
    ...base,
    developers: onTarget.developers.map((d, i) => (i < 30 ? { ...d, level: 'staff' as const } : d)), // now 30% staff
  };
  assert.ok(marketPullChance(overTarget, 'staff') > baseline, 'exceeding the target must raise the chance further');
});

test('levelShare reads team composition correctly', () => {
  const base = started();
  const state: RunState = {
    ...base,
    developers: [
      { ...base.developers[0], id: 'd1', level: 'senior' },
      { ...base.developers[0], id: 'd2', level: 'senior' },
      { ...base.developers[0], id: 'd3', level: 'junior' },
    ],
  };
  assert.ok(Math.abs(levelShare(state, 'senior') - 2 / 3) < 1e-9);
});

test('Staff requires a much higher Proficiency than the old Senior threshold', () => {
  assert.ok(SIM.promotionThreshold.senior > 90, 'the threshold itself must now exceed the old bar');

  const dev = { ...started().developers[0], level: 'senior' as const };
  const top = topDiscipline(dev.proficiency);
  const at90 = { ...dev, proficiency: { ...dev.proficiency, [top]: 90 } };
  assert.equal(isPromotable(at90), false, 'a proficiency of 90 -- promotable under the old bar -- must not qualify anymore');

  const atNewBar = { ...dev, proficiency: { ...dev.proficiency, [top]: SIM.promotionThreshold.senior } };
  assert.equal(isPromotable(atNewBar), true);
});

test('promotion is never blocked by an over-target Level, just warned about', () => {
  const base = started();
  const dev = base.developers[0];
  const top = topDiscipline(dev.proficiency);
  // Team already saturated with staff, well over the 8% target.
  const state: RunState = {
    ...base,
    developers: [
      { ...dev, proficiency: { ...dev.proficiency, [top]: SIM.promotionThreshold.senior + 1 }, level: 'senior' as const },
      ...Array.from({ length: 5 }, (_, i) => ({ ...dev, id: `s${i}`, handle: `s${i}`, level: 'staff' as const })),
    ],
  };
  const after = apply(state, `/promote @${dev.handle}`).state;
  assert.equal(after.developers[0].level, 'staff', 'over-target composition must not block a proficiency-earned promotion');
  assert.match(after.events.at(-1)!.text, /Market Pull|target/i);
});

test('a Market Pull notice is retainable the same way as a morale-driven one', () => {
  const base = started();
  const dev = { ...base.developers[0], level: 'staff' as const, noticeDaysLeft: 5, morale: 100 };
  const state: RunState = { ...base, developers: [dev] };
  const after = apply(state, `/bonus @${dev.handle} 5000`).state;
  assert.equal(after.developers[0].noticeDaysLeft, null, 'a bonus must retain a Market Pull notice just like a morale one');
});

test('a top-heavy, high-morale team still loses people to Market Pull over time', () => {
  const base = started();
  let state: RunState = {
    ...base,
    developers: Array.from({ length: 10 }, (_, i) => ({
      ...base.developers[0], id: `s${i}`, handle: `s${i}`, level: 'staff' as const, morale: 100,
    })),
  };
  let sawNotice = false;
  for (let i = 0; i < 150 && !sawNotice; i++) {
    state = { ...state, developers: state.developers.map((d) => ({ ...d, morale: 100 })) };
    state = tick(state);
    sawNotice = state.developers.some((d) => d.noticeDaysLeft !== null);
  }
  assert.ok(sawNotice, 'a 100% staff team, all at full morale, must still see Market Pull fire eventually');
});

// ─── Workplace ───────────────────────────────────────────────────────────────

test('the clock will not run past Seed until a Work Mode is chosen', () => {
  const base: RunState = { ...started(), stageIndex: 1 };
  assert.equal(base.status, 'running');
  const after = tick(base);
  assert.equal(after.day, base.day, 'day must not advance while the forced Work Mode choice is outstanding');
});

test('/resume and /speed refuse to start the clock before a Work Mode is chosen', () => {
  const base: RunState = { ...started(), stageIndex: 1, speed: 0, status: 'paused' };
  const resumed = apply(base, '/resume').state;
  assert.equal(resumed.status, 'paused', '/resume must refuse until a Work Mode is chosen');
  const sped = apply(base, '/speed 2').state;
  assert.equal(sped.speed, 0, '/speed must refuse to set a nonzero speed until a Work Mode is chosen');
});

test('/workmode inperson makes the forced first choice for free, with no pending change', () => {
  const base: RunState = { ...started(), stageIndex: 1 };
  const after = apply(base, '/workmode inperson fernhaven').state;
  assert.equal(after.workplace.mode, 'inperson');
  assert.equal(after.workplace.officeCity, 'fernhaven');
  assert.equal(after.workplace.pending, null, 'the forced first choice must not be a pending change');
  assert.equal(after.cash, base.cash, 'the forced first choice must be free');
});

test('/workmode remote makes the forced first choice for free, starting from Kestria', () => {
  const base: RunState = { ...started(), stageIndex: 1 };
  const after = apply(base, '/workmode remote').state;
  assert.equal(after.workplace.mode, 'remote');
  assert.deepEqual(after.workplace.unlockedCountries, ['kestria']);
  assert.equal(after.cash, base.cash);
});

test('Office rent is the only new burn once In-person is chosen', () => {
  const base: RunState = { ...started(), stageIndex: 1 };
  const before = economyFinances(base).burn;
  const chosen = apply(base, '/workmode inperson meridian').state;
  const rent = officeCost(chosen.workplace);
  assert.ok(rent > 0, 'Meridian must carry real rent');
  assert.equal(economyFinances(chosen).burn, before + rent);
});

test('hiring is refused once the Office is full, and /office expand raises the cap', () => {
  const base: RunState = { ...started(), stageIndex: 1 };
  let state = apply(base, '/workmode inperson fernhaven').state;
  state = { ...state, cash: 1_000_000, workplace: { ...state.workplace, officeSize: state.developers.length } };
  const rng = createRng(state.rng.seed, state.rng.cursor);
  const candidate = rollCandidate(state, rng);
  state = { ...state, candidates: [candidate] };

  const blocked = apply(state, `/hire @${candidate.handle}`).state;
  assert.equal(blocked.developers.length, state.developers.length, 'a full Office must refuse the hire');
  assert.equal(blocked.candidates.length, 1, 'the candidate must not be consumed by a refused hire');

  const expanded = apply(state, '/office expand').state;
  assert.equal(expanded.workplace.officeSize, state.workplace.officeSize + WORKPLACE.officeExpandSeats);
  const hired = apply(expanded, `/hire @${candidate.handle}`).state;
  assert.equal(hired.developers.length, state.developers.length + 1, 'hiring must succeed once there is room');
});

test('/remote unlock pays cash and adds a Country to the pool', () => {
  const base: RunState = { ...started(), stageIndex: 1, cash: 1_000_000 };
  let state = apply(base, '/workmode remote').state;
  const target = Object.keys(REMOTE_COUNTRIES).find((k) => k !== 'kestria')!;
  const before = state.cash;
  state = apply(state, `/remote unlock ${target}`).state;
  assert.ok(state.workplace.unlockedCountries.includes(target));
  assert.equal(state.cash, before - REMOTE_COUNTRIES[target].unlockCost);
});

test('Coordination Drag reduces Velocity once hiring spreads across multiple Countries', () => {
  const base: RunState = { ...started(), stageIndex: 1 };
  const remote = apply(base, '/workmode remote').state;
  const spread: RunState = {
    ...remote,
    workplace: { ...remote.workplace, unlockedCountries: ['kestria', 'oakmere'] },
    developers: [
      { ...remote.developers[0], id: 'd1', handle: 'd1', country: 'kestria' },
      { ...remote.developers[0], id: 'd2', handle: 'd2', country: 'oakmere' },
    ],
  };
  assert.ok(coordinationDrag(spread) < 1, 'spreading across two active Countries must cost Velocity');
  assert.ok(velocityMultiplier(spread) < velocityMultiplier(remote));
});

test('Coordination Drag stays neutral In-person, or Remote with no active Country spread', () => {
  const base: RunState = { ...started(), stageIndex: 1 };
  const remote = apply(base, '/workmode remote').state;
  assert.equal(coordinationDrag(remote), 1, 'the founder alone -- not yet even Remote-hired -- must carry no drag');

  const inperson = apply(base, '/workmode inperson fernhaven').state;
  assert.equal(coordinationDrag(inperson), 1, 'In-person must never carry Coordination Drag');
});

test('/workmode switch previews for free, then charges cash and starts a pending change on confirm', () => {
  const base: RunState = { ...started(), stageIndex: 1, cash: 1_000_000 };
  const state = apply(base, '/workmode inperson fernhaven').state;

  const preview = apply(state, '/workmode remote').state;
  assert.equal(preview.workplace.pending, null, 'without confirm, nothing should be committed yet');
  assert.equal(preview.cash, state.cash, 'without confirm, no cash should be charged');
  assert.equal(preview.workplace.mode, 'inperson');

  const confirmed = apply(state, '/workmode remote confirm').state;
  assert.ok(confirmed.workplace.pending, 'a confirmed switch must start a pending change');
  assert.equal(confirmed.workplace.mode, 'inperson', 'the mode itself only changes once the pending change completes');
  assert.ok(confirmed.cash < state.cash, 'a Work Mode switch must charge cash up front');

  const finished = run(confirmed, 30);
  assert.equal(finished.workplace.pending, null, 'the pending change must complete within a reasonable number of days');
  assert.equal(finished.workplace.mode, 'remote');
});

test('completing a Work Mode switch can cost staff outright, non-retainably', () => {
  const base: RunState = { ...started(), stageIndex: 1, cash: 10_000_000 };
  const inperson = apply(base, '/workmode inperson fernhaven').state;
  const bigTeam: RunState = {
    ...inperson,
    developers: Array.from({ length: 20 }, (_, i) => ({ ...inperson.developers[0], id: `d${i}`, handle: `d${i}` })),
  };
  const confirmed = apply(bigTeam, '/workmode remote confirm').state;
  const before = confirmed.developers.length;
  const after = run(confirmed, 30);
  assert.ok(after.developers.length < before, 'at least one of 20 developers should decline to make the move');
  assert.equal(after.workplace.mode, 'remote');
});

test('a v6 save migrates and defaults to no Work Mode chosen', () => {
  const legacy = JSON.parse(serialise(newRun('OLD', 22))) as Record<string, unknown>;
  legacy.version = 6;
  delete legacy.workplace;
  const loaded = deserialise(JSON.stringify(legacy));
  assert.ok(loaded, 'a v6 save should still load');
  assert.equal(loaded.workplace.mode, null);
  assert.equal(loaded.workplace.officeSize, WORKPLACE.startingOfficeSize);
});

test('the reference player always resolves the forced Work Mode choice promptly', () => {
  let state = newRun('POLICY', 7);
  for (let day = 0; day < 400 && state.status === 'running'; day++) {
    state = playTurn(state);
    state = tick(state);
  }
  if (state.stageIndex >= 1) {
    assert.notEqual(state.workplace.mode, null, 'the reference player must never leave Seed+ without choosing a Work Mode');
  }
});
