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

Managed is the exception: its replicas autoscale on their own every Day (`tick.ts`:
`doManagedDbAutoscale`), up or down, rather than the player buying a fixed count with `/scale db`
-- which is refused outright while Managed is active. That convenience is priced into its higher
`costMultiplier`; the player never gets the option to under-provision it to save money.

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

## Workplace

The moment the company enters Seed, the clock stops until you pick a Work Mode -- In-person or
Remote (ADR-0006) -- mirroring how Architecture is chosen once at founding. It isn't a cosmetic
label: the two are genuinely different systems, and switching later (`/workmode <mode> confirm`)
costs cash, days of reduced Velocity, and some current staff outright -- non-retainably, real
people who don't want the job they signed up for to change shape.

```
/workmode                        view the current choice, or the forced first pick
/workmode inperson <city>        the forced first choice: pick an Office City, free
/workmode remote                 the forced first choice: go Remote, starting from Kestria
/workmode <mode> [city] confirm  switch later -- costly, takes days, some staff leave
/office                          view the Office: headcount cap, rent, local pool/salary
/office expand                   pay to raise the headcount cap
/office relocate <city> confirm  move to a different City -- cheaper than a full switch
/remote                          view unlocked and locked Countries, Coordination Drag
/remote unlock <country>         pay to add a Country to the hiring pool, instantly
```

In-person carries one fictional Office City at a time (`OFFICE_CITIES` in `tuning.ts`) -- fixed
rent that scales with headcount, a lower salary expectation, and a capacity that must be expanded
(at cost) to keep hiring past it; a full Office refuses `/hire` outright. Remote carries a set of
independently-unlockable Countries (`REMOTE_COUNTRIES`) -- no rent, a pricier and larger candidate
pool, and Coordination Drag: an ongoing Velocity cost that grows with how many Countries currently
have an active hire, the same shape as Tech Debt's Drag. Concentrating hiring keeps Drag low;
spreading wide for a bigger pool costs real throughput.

The reference player must make this choice too, immediately upon reaching Seed (In-person, the
cheapest City), or the balance harness would stall forever at the forced pause -- a real dependency
the harness now carries, the same way it depends on choosing a main Architecture.

## Standing auto-assign and focus

```
/auto              turn on standing auto-assign, or assign idle developers right now
/auto off           stop; developers idle until you /assign them
/auto once          assign now without turning the mode on
/auto bug|feature|debt   turn on, and steer the team toward one Ticket type
/auto all           clear focus, back to balanced value-based Triage
```

Focus is a strong preference, not a hard filter: `planAssignments` (`src/sim/triage.ts`) boosts the
focused type's sort key by a constant large enough to dominate any real economic value, so a
matching Ticket always wins when one is open -- but a Developer never sits idle just because the
focus queue happens to be empty; they fall back to the next-best work of any type. Focus persists
independently of the on/off toggle, so `/auto off` then `/auto` resumes whatever focus was last set.
The reference player never sets a focus (it always uses balanced Triage), so this has no effect on
the balance numbers below.

## Backlog pressure

Tickets arrive faster than headcount alone can absorb, and the gap widens by Stage in two ways:
`arrivalBaseSp` (a flat, headcount-independent floor per Stage -- this is the "you genuinely cannot
do this alone" lever, since it doesn't scale down just because the team is small) and
`arrivalTeamMultiplier` (per-head pressure, so a bigger team also faces a bigger inbox, not just
more hands). Seed's `arrivalBaseSp` in particular is tuned so a solo, never-hiring player's MRR
growth plateaus well short of the goal -- confirmed by isolating the effect with morale pinned (to
rule out burnout-quitting as a confound): three seeded solo runs capped out around $20-26k against
a $145k goal, and in the unlucky seed the backlog outright diverged instead of stabilizing.

An open Bug or Tech Debt Ticket left too long ratchets its Severity up (Escalation); an old Feature
is withdrawn instead (lost opportunity, not a growing liability). `/board` defaults to what's
actually urgent (escalated or near-expiry) rather than the whole pile;
`/board all|bug|feature|debt|stale` filters.

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

  won         146  48.7%   median day 856
  bankrupt    143  47.7%   median day 531
  timeout      11   3.7%   median MRR $180,999

  STAGE                 reached      cleared
  GARAGE     ████████████████████  300    259  86%
  SEED       █████████████████···  259    200  77%
  SERIES A   █████████████·······  200    184  92%
  IPO        ████████████········  184    146  79%
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

Adding Target Mix / Market Pull (2026-09) -- Staff becoming genuinely rare, and Senior/Staff facing a
standing departure risk independent of Morale -- crashed the win rate to 0% before Workplace was
even started. The chain, in order: `rng.chance()` always consumes an RNG draw even at `p=0`, so
calling Market Pull's roll unconditionally for every Developer every Day (rather than guarding on
`pullChance > 0`) desynced the whole downstream RNG stream from what a Seed used to produce; fixing
that alone wasn't enough, because the entire difficulty curve had been implicitly tuned around fast
Staff promotion's velocity boost bailing out a solo founder, so raising the Staff threshold pulled
that crutch out from under every Stage at once (fixed by raising `SIM.baseVelocity.senior`/`staff`);
a separate real bug in the retention-raise fallback retried an uncapped 20%-of-salary raise every Day
Notice was active, compounding into runaway burn (fixed with a ceiling); and the candidate-sort
policy was reaching for the best velocity/dollar even on a cash-thin first hire (fixed by sorting
cheapest-first while the team is still tiny). That pass landed at 24% (N=300), explicitly left
unfinished pending the Workplace feature's own economic changes.

Landing Workplace (ADR-0006) dropped the number further, to ~9.7% (N=300) -- but isolating it proved
Workplace's own costs (Office rent, the hiring-capacity gate, the City salary multiplier) were each
independently *not* the driver: zeroing any one of them out, one at a time, reproduced the exact same
win count. The real cause was the still-unfinished Market Pull pass above, finished in the same
session as this note: `SIM.moraleBaselineRecovery` (0.45 -> 0.6) was the single biggest lever -- a
small early team that's deliberately too busy to ever go idle (`arrivalBaseSp` outpaces a solo/duo
founder on purpose) got none of `moraleIdleRecovery`'s cushion either, so ordinary bad luck had
nothing to pull Morale back before Notice; the harness caught this as Garage deaths clustering around
day 400+, long after a run had visibly stalled but well before it looked doomed. Garage's
`arrivalBaseSp` (0.5 -> 0.42) and IPO's `salaryMult`/`arrivalTeamMultiplier` (1.35/1.9 -> 1.25/1.7)
were both eased -- IPO in particular was bankrupting well-staffed 8-17 person teams on burn alone, not
mismanagement. The reference player's zero-headcount hire threshold was also loosened (it required a
2-month cash cushion on top of the recruiter fee, which a team stuck at zero developers -- earning
and fixing nothing every Day it waited -- often couldn't clear, locking the run out of its own
recovery path). Landed at 48.7% (N=300), 48-51% stable across N=350/500/800.

**2026-09-06, early-game retune.** Player feedback: the early Stages felt too easy (Garage was
clearing 88%, Seed 98%). Tightened Garage (goal, base churn, arrival) and Seed (goal, base churn,
arrival, arrivalTeamMultiplier) specifically, leaving Series A/IPO's own numbers close to where they
were. Two things worth remembering:

- The harness is fully deterministic (seeds `1..N`), so re-running with the *same* `--runs` value
  is not a second sample -- it reproduces byte-identical output. Confirm stability with a
  *different* `N` (e.g. 300 then 400), not a repeated run.
- Series A's own clear rate barely moved even after raising its churn -- a survivorship effect. Once
  Garage/Seed are the harder gate, whoever reaches Series A is disproportionately well-run, and a
  moderate churn change there mostly just tightens their IPO margin rather than failing them at
  Series A itself. Don't chase a stage's raw clear-rate number past the point where a knob stops
  visibly moving it; check the *downstream* stage instead.

**2026-09-07, Seed volume tuning.** Player feedback: hiring should be *forced* by ticket volume in
Seed, not just made economically wise. Converted `arrivalBaseSp` from a single global constant into
a per-Stage field -- it's the headcount-independent floor, so it's the correct lever for "cannot do
this alone" without also punishing teams that already hired (raising `arrivalTeamMultiplier`
instead would have scaled the pain with headcount too, hurting a 6-person team almost as much as a
solo one). First attempt (`arrivalBaseSp: 3.6`) overshot badly -- Seed's clear rate crashed to 57%
and the reference player's own median final team size collapsed from ~35 to 8, meaning even *active
hiring* couldn't keep pace. Backed off to `1.8`, which held Seed's clear rate at a meaningfully
tighter 83% while team growth recovered. Verified the actual goal directly rather than trusting the
harness's aggregate number: a probe with morale pinned (removing burnout-quitting as a confound)
showed a realistic solo founder's MRR plateauing around $20-26k against Seed's $145k goal across
three seeds -- confirming volume alone is the blocker, not bad luck on churn or debt.

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
