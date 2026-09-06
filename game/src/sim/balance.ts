/**
 * Headless balance harness (ADR-0003).
 *
 *   npx tsx src/sim/balance.ts [--runs 300] [--days 1200]
 *
 * Runs the reference player over many Seeds and reports, per Stage, how often a
 * competent player gets through. Target is roughly a 50% overall win rate with
 * every Stage reachable and none of them a formality.
 */

import { playTurn } from './policy';
import { newRun } from './state';
import { tick } from './tick';
import { STAGES } from './tuning';

interface Outcome {
  status: 'won' | 'lost' | 'timeout';
  day: number;
  stageReached: number;
  mrr: number;
  team: number;
}

function simulate(seed: number, maxDays: number): Outcome {
  let state = newRun('HARNESS', seed);
  let deepest = 0;

  while (state.status === 'running' && state.day < maxDays) {
    state = playTurn(state);
    state = tick(state);
    deepest = Math.max(deepest, state.stageIndex);
  }

  return {
    status: state.status === 'won' ? 'won' : state.status === 'lost' ? 'lost' : 'timeout',
    day: state.day,
    stageReached: state.status === 'won' ? STAGES.length : deepest,
    mrr: state.mrr,
    team: state.developers.length,
  };
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function arg(flag: string, fallback: number): number {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
}

const runs = arg('--runs', 300);
const maxDays = arg('--days', 1200);

const started = Date.now();
const outcomes: Outcome[] = [];
for (let seed = 1; seed <= runs; seed++) outcomes.push(simulate(seed, maxDays));
const elapsed = Date.now() - started;

const wins = outcomes.filter((o) => o.status === 'won');
const losses = outcomes.filter((o) => o.status === 'lost');
const timeouts = outcomes.filter((o) => o.status === 'timeout');

console.log(`\nMUTELY BALANCE  ${runs} runs, ${maxDays} day cap, ${elapsed}ms\n`);
console.log(`  won       ${String(wins.length).padStart(4)}  ${((wins.length / runs) * 100).toFixed(1)}%   median day ${median(wins.map((o) => o.day))}`);
console.log(`  bankrupt  ${String(losses.length).padStart(4)}  ${((losses.length / runs) * 100).toFixed(1)}%   median day ${median(losses.map((o) => o.day))}`);
console.log(`  timeout   ${String(timeouts.length).padStart(4)}  ${((timeouts.length / runs) * 100).toFixed(1)}%   median MRR $${Math.round(median(timeouts.map((o) => o.mrr))).toLocaleString()}`);

console.log('\n  STAGE                 reached      cleared');
for (let i = 0; i < STAGES.length; i++) {
  const reached = outcomes.filter((o) => o.stageReached >= i).length;
  const cleared = outcomes.filter((o) => o.stageReached > i).length;
  const rate = reached > 0 ? ((cleared / reached) * 100).toFixed(0) : '--';
  const bar = '█'.repeat(Math.round((reached / runs) * 20)).padEnd(20, '·');
  console.log(`  ${STAGES[i].name.padEnd(10)} ${bar} ${String(reached).padStart(4)}  ${String(cleared).padStart(5)}  ${rate}%`);
}

console.log(`\n  median final team ${median(outcomes.map((o) => o.team))}\n`);
