# Mutely

A startup-management simulation played entirely from a terminal. You run a software company
across four Stages -- Garage, Seed, Series A, IPO -- hiring developers, triaging a backlog, and
staying solvent.

See [`CONTEXT.md`](../CONTEXT.md) for the domain language and [`docs/adr/`](../docs/adr) for the
three decisions that shape the codebase.

## Running

```bash
npm run dev        # play at http://localhost:3000
npm test           # simulation unit tests
npm run balance    # headless balance harness
```

## The four Pressures

Almost every mechanic maps to one force working against the player -- except Tech Debt, which
deliberately spans two (see [ADR-0004](../docs/adr/0004-infra-is-a-fourth-pressure.md)):

| Pressure | Attacks | Mechanism |
| --- | --- | --- |
| Bugs | Revenue | Multiply the churn rate by severity |
| Over Capacity | Revenue | Multiply the churn rate, same mechanism as a Bug |
| Tech debt | Throughput *and* Revenue | Drags team velocity, *and* inflates the Capacity needed to serve current Traffic |
| Salaries + infra spend | Solvency | Monthly cash burn |

MRR is a stock that churns continuously, so standing still loses money. Debt slows shipping and
inflates infra needs at once -- the death spiral is reachable by design.

## Infrastructure

Traffic grows on its own schedule, independent of MRR, and occasionally spikes. The company runs
on one of three Architectures -- monolith, kubernetes, or serverless -- each with its own capacity
and cost formula (`src/sim/economy.ts`: `rawComputeCapacity`, `computeCost`). Efficiency comes from
team Proficiency already tracked for ticket-matching: average `devops` Proficiency for compute,
`dba` for the database -- so senior hires pay off continuously, not just when an infra-flavored
ticket happens to be open.

```
/infra                      architecture, traffic vs capacity, cost breakdown
/scale compute|db <+/-N>    add or remove capacity, changes the recurring bill
/migrate <architecture>     preview a switch; add "confirm" to commit (costly, takes days)
```

Traffic compounds exponentially forever, with no ceiling -- so a run that drags on too long
eventually goes bankrupt on infra cost alone, regardless of how well tickets are triaged. That's
deliberate: it's what killed the old timeout outcome (a run neither winning nor losing before the
day cap) and replaces it with a genuine loss.

## Balancing

The simulation owns every number ([ADR-0001](../docs/adr/0001-simulation-owns-the-economy.md)), so
balancing is editing `src/sim/tuning.ts` and re-running the harness. Nothing else.

```bash
npm run balance -- --runs 250 --days 1600
```

The harness plays hundreds of seeded Runs with a reference player (`src/sim/policy.ts`) standing in
for a competent human, and reports how far each Run got:

```
MUTELY BALANCE  160 runs, 1400 day cap

  won         151  50.3%   median day 920
  bankrupt    149  49.7%   median day 1120
  timeout       0   0.0%

  STAGE                 reached      cleared
  GARAGE     ████████████████████  300    298   99%
  SEED       ████████████████████  298    298  100%
  SERIES A   ████████████████████  298    264   89%
  IPO        ██████████████████··  264    151   57%
```

The target is roughly a 50% overall win rate with a rising curve -- Garage as a tutorial, IPO as a
genuine wall. A Stage sitting at 100% is a formality and needs tightening; one below ~40% is a
brick wall.

Use at least 150 runs before trusting a number. A 70-run sweep of this same tuning read 45.7%
where 250 runs read 37.6% -- small samples run several points optimistic.

Improving the reference player counts as a balance change, and so does improving `/auto` itself.
Two changes moved the win rate from 48% to 81% before any Tuning Table was touched: sharing
`triage.ts` between `/auto` and the reference player (globally-greedy matching, bug work priced
before MRR exists), then making standing auto-assign reassign a Developer the instant they finish a
Ticket -- same tick, not the next day. That second change alone is worth more at a large team, since
every Developer who is never idle for even one Day compounds hard over an 800+ day run. Re-measure
after touching `policy.ts`, `triage.ts`, or `tick.ts`'s `doAutoAssign`.

Because every Roll derives from the Run's Seed, a scenario is reproducible: `/seed` prints it, and
the same Seed replays the same bugs on the same days.

## Layout

```
src/sim/        framework-free simulation core -- pure functions over serialisable state
  tuning.ts       every number in the game, including INFRA (architecture cost/capacity formulas)
  economy.ts      derived state: churn, drag, capacity, efficiency, infra cost
  tick.ts         one Day: work, attrition, traffic, migration, finances, arrivals, stage gate
  commands.ts     the entire input surface
  triage.ts       assignment valuation, shared by /auto and the reference player
  policy.ts       reference player, used only by the harness (manages infra too)
  balance.ts      the harness
src/components/ read-only Telemetry panels + the Terminal
src/lib/        save slots, and the background Flavor refill
```

The LLM only writes titles and names into the Flavor Queue. It cannot author a quantity, and the
game is fully playable with the endpoint down -- it falls back to built-in phrase tables.
