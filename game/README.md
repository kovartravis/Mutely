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

Traffic grows on its own schedule, independent of MRR, and occasionally spikes (a spike bumps one
Day only -- the underlying trend is a separate `trafficBaseline` that never ratchets upward from a
spike, see the balance notes below). The company runs on one of three Architectures -- monolith,
kubernetes, or serverless -- each with its own capacity and cost formula. A second axis sits under
that: a Database engine and a Compute runtime, each with an explicit trade-off (a size delta added
to every rolled Ticket, a Capacity multiplier) spelled out in full on `/architecture`. Which
Database engines are available depends on the main Architecture (ADR-0005).

Efficiency comes from team Proficiency already tracked for ticket-matching: average `devops`
Proficiency for compute, `dba` for the database -- so senior hires pay off continuously, not just
when an infra-flavored ticket happens to be open.

```
/infra                       one-line architecture, capacity, and cost summary
/architecture                the full diagram -- every axis, every trade-off, spelled out
/scale compute|db <+/-N>     add or remove capacity, changes the recurring bill
/migrate <architecture>      preview a switch; add "confirm" to commit (costly, takes days)
/switch db|runtime <target>  switch a Sub-architecture -- same mechanism, smaller bet
/cache buy|upgrade|refresh   an optional layer that absorbs Traffic before Compute/DB see it
```

Traffic compounds exponentially forever, with no ceiling -- so a run that drags on too long
eventually goes bankrupt on infra cost alone, regardless of how well tickets are triaged. That's
deliberate: it's what killed the old timeout outcome (a run neither winning nor losing before the
day cap) and replaces it with a genuine loss.

## Backlog pressure

Tickets arrive faster than headcount alone can absorb, and the gap widens by Stage
(`arrivalTeamMultiplier`) -- the backlog is meant to outpace hiring, not track it. An open Bug or
Tech Debt Ticket left too long ratchets its Severity up (Escalation); an old Feature is withdrawn
instead (lost opportunity, not a growing liability). `/board` defaults to what's actually urgent
(escalated or near-expiry) rather than the whole pile; `/board all|bug|feature|debt|stale` filters.

## Promotion

A Developer becomes Promotable once their Proficiency in their top Discipline crosses a threshold
-- derived, not stored, same as Discipline itself. The Team panel flags it (`▲ promotable`);
`/promote @dev` commits it, raising their Level (a real Velocity tier, not just cosmetic) and
scaling salary with it.

## Balancing

The simulation owns every number ([ADR-0001](../docs/adr/0001-simulation-owns-the-economy.md)), so
balancing is editing `src/sim/tuning.ts` and re-running the harness. Nothing else.

```bash
npm run balance -- --runs 250 --days 1600
```

The harness plays hundreds of seeded Runs with a reference player (`src/sim/policy.ts`) standing in
for a competent human, and reports how far each Run got:

```
MUTELY BALANCE  300 runs, 1600 day cap

  won         156  52.0%   median day 1128
  bankrupt    144  48.0%   median day 1000
  timeout       0   0.0%

  STAGE                 reached      cleared
  GARAGE     ████████████████████  300    264   88%
  SEED       ██████████████████··  264    259   98%
  SERIES A   █████████████████···  259    247   95%
  IPO        ████████████████····  247    156   63%
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

Adding the backlog/architecture depth (2026-09-06) surfaced two real bugs the harness caught, not
tuning problems:

- **An uncapped `debtInflation`.** Unlike `churnRate` (capped by `maxChurnMultiplier`), an escalating,
  never-fixed Tech Debt Ticket compounded its Capacity-inflation weight forever -- 25x, then 34x by
  day 280 in one traced run, forcing ever-larger purchases onto the monolith's superlinear cost
  curve until a *solo founder* went bankrupt on infra cost alone. Any weight that compounds off an
  unbounded input (Escalation Level, in this case) needs the same ceiling `churnRate` already has --
  see `INFRA.maxDebtInflation`.
- **A pricing blind spot in `triage.ts`.** Fixing Tech Debt was priced only by its Drag relief, never
  by the infra-cost it was quietly inflating in the background -- so neither `/auto` nor the
  reference player had any signal to prioritize the ticket that was about to bankrupt them. Fixed
  by adding an infra-savings term to the debt valuation (see `debtInflationWeight` in `economy.ts`).

Also: a gate meant to keep the reference player from making disruptive infra bets (migrating,
switching, buying a Cache) *before its second hire* was applied to the Runtime/Cache checks but
missed the main-Architecture migration check entirely -- a solo founder could still get migrated to
kubernetes, eating a large cash cost and a 50%-velocity penalty alone. Any new "don't do this while
still tiny" guard needs to cover every trigger that shares the guard's premise, not just the ones
added in the same edit.

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
