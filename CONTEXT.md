# Mutely

A startup-management simulation game, played entirely from a terminal. The player runs a software
company across four Stages -- hiring Developers, triaging a backlog, and staying solvent. The
simulation owns every number; an LLM only writes the words.

## Language

### Run structure

**Run**:
One complete playthrough of the campaign, from founding to victory or Bankruptcy.

**Stage**:
A named chapter of a Run (Garage, Seed, Series A, IPO) with its own goal and Tuning Table.
Meeting a Stage's goal triggers a Funding Round and advances the Run.
_Avoid_: level, chapter, phase

**Day**:
The unit of simulated time. One Day is one tick of the simulation.

**Seed**:
The per-Run random number every Roll derives from. It makes a Run reproducible, which is how
Tuning Tables get tested.

### Content generation

**Roll**:
The simulation's act of generating a game object -- Ticket, Candidate, Event -- with all of its
numeric properties drawn from the current Stage's Tuning Table.

**Flavor**:
The human-readable title, description, name, or blurb the LLM writes for an already-Rolled object.
Flavor never carries numbers and never affects the simulation.
_Avoid_: narrative, content, generation

**Flavor Queue**:
The background-filled buffer of unused Flavor, bucketed by Ticket type and Discipline. The
simulation pops from it synchronously when it Rolls, so LLM latency is never on the player's
critical path. When it runs dry the game falls back to a built-in phrase table.

**Tuning Table**:
The per-Stage set of constants the simulation Rolls against -- salary bands, Ticket size range,
arrival rates, base Churn, and the Stage goal. Balancing the game means editing these and
nothing else.

### Economy

**MRR**:
Monthly recurring revenue. Revenue attributed to shipped Features, reduced continuously by Churn.
Not a running total of everything ever completed.

**Churn**:
The monthly percentage of MRR lost to departing customers. Always active, so standing still loses
revenue.

**Drag**:
The multiplier unresolved Tech Debt applies to the whole team's Velocity. Ignoring debt slows
shipping, which accelerates the loss of MRR to Churn.
_Avoid_: penalty, debt tax

**Pressure**:
One of the forces working against the player, attacking revenue, throughput, or solvency. Bugs and
Over Capacity both raise Churn (revenue). Tech Debt applies Drag to Velocity (throughput) *and*
inflates the Capacity required to serve current Traffic (revenue, via Over Capacity) -- the one
mechanic that deliberately spans two Pressures; see ADR-0004. Salaries and infrastructure spend both
burn Cash (solvency).

**Funding Round**:
The event fired when a Stage's goal is met. It injects Cash and swaps in the next Stage's Tuning
Table, raising salaries, Churn, Ticket size, and the goal itself.

**Bankruptcy**:
Cash falling below zero. The only losing condition, evaluated continuously rather than at month
boundaries.

### Work

**Discipline**:
One area of engineering competence (frontend, backend, devops, ml, dba). Every Ticket requires
exactly one Discipline; every Developer has a Proficiency in each.
_Avoid_: role, skill, specialty

**Proficiency**:
A Developer's 0-100 rating in one Discipline, scaling how fast they work Tickets requiring it.
Proficiency grows as the Developer ships Tickets in that Discipline.

**Velocity**:
Story points a Developer completes per Day, after Proficiency, Morale, and Drag are applied. The
raw per-level figure before those modifiers is their *base velocity*.

**Triage**:
The valuation ranking a Developer/Ticket pairing by steady-state dollars per day of their time.
One implementation serves both the player's auto-assign and the balance harness's reference player,
so the win rates the harness reports describe the game the player is actually handed.

### People

**Morale**:
A Developer's 0-100 wellbeing. Scales their Velocity with no floor, and when low, drives the chance
they resign.

**Notice**:
The countdown period after a Developer decides to resign, during which the player can still retain
them by spending Cash. When Notice expires the Developer leaves and their Proficiency is lost.
_Avoid_: quit, resignation, attrition

### Interface

**Handle**:
The short, stable, player-facing address of a game object -- `#a3` for a Ticket, `@marcus` for a
Developer. Handles appear on every Telemetry panel, so what the player reads is what they type.
_Avoid_: id, slug, tag

**Command**:
A typed instruction in the terminal. Commands are the only way to change game state.

**Telemetry**:
The always-visible read-only panels -- finances, team, board, event feed. Telemetry never accepts
input.
_Avoid_: dashboard, widget

**Save Slot**:
A named, player-managed snapshot of a Run, plus one automatic slot that always tracks the live Run
for crash recovery. Loading is unrestricted.

### Infrastructure

**Architecture**:
The company's compute model -- monolith, kubernetes, or serverless. Chosen at founding (monolith by
default) and changeable only via Migration.

**Migration**:
A one-time, costly switch from one Architecture to another. Charges Cash up front and applies a
Velocity penalty to the whole team for its duration.

**Traffic**:
Simulated daily request volume the product must serve. Grows on its own schedule and spikes
occasionally, independent of MRR.

**Capacity**:
How much Traffic the current infrastructure can serve. Computed from the Architecture's
compute resource (Nodes for kubernetes, Concurrency for serverless, Tier for monolith) and
Database replicas -- whichever is the tighter bottleneck -- each scaled by Efficiency.

**Efficiency**:
A multiplier on how far a unit of infrastructure goes, driven by team Proficiency: devops
Proficiency for compute, dba Proficiency for databases. A senior-heavy team makes the same Node or
replica serve more Traffic; a junior-heavy team needs to buy more of it.

**Over Capacity**:
When Traffic exceeds Capacity. Raises Churn the same way an open Bug does -- infrastructure is a
fourth force attacking revenue, alongside Bugs, Tech Debt, and salaries.

### Backlog pressure

**Escalation**:
What happens to an open Bug or Tech Debt Ticket left too long: its Severity ratchets up one step
per aging threshold, capped at critical. Further aging past critical keeps compounding as an
Escalation Level, so an old critical Ticket is worse than a freshly-critical one.
_Avoid_: decay, aging (too vague -- Escalation is specifically the severity ratchet)

**Withdrawal**:
What happens to an open Feature left too long: it is removed from the backlog entirely rather than
escalating. A lost opportunity, not a growing liability -- the market moved on.

### Architecture (extended)

**Sub-architecture**:
A second choice nested under the main Architecture -- a Database engine and a Compute runtime,
each with its own explicit trade-off (a size delta applied to every rolled Ticket, and a Capacity
multiplier). Which Sub-architectures are available depends on the main Architecture. Switching one
reuses the Migration mechanism, scaled down. The Managed Database engine is the one exception to
manual `/scale`: its replica count autoscales every Day on its own, at a cost premium -- the
player never gets to under-provision it to save money.

**Cache**:
An optional layer that serves a share of Traffic before it reaches Compute or the Database,
reducing required Capacity by its hit rate. Decays if not refreshed, and a badly stale Cache can
spawn a Bug of its own -- an upkeep loop, not a one-time purchase.

### People (extended)

**Promotable**:
A Developer whose Proficiency in their top Discipline has crossed the threshold for their next
Level. Derived, not stored -- like Discipline itself. `/promote` commits it: base Velocity rises a
tier, salary scales with it, and Morale gets a real boost.
