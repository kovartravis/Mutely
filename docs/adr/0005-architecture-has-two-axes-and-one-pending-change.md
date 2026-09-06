# Architecture has two axes plus a Cache, and only one pending change at a time

Infrastructure gained a second choice axis: a Database engine and a Compute runtime Sub-
architecture, each with an explicit trade-off (a size delta on every rolled Ticket, a Capacity
multiplier), nested under the main Architecture. Availability of Sub-architectures depends on the
main Architecture -- a real cloud-managed database only makes sense once you're not running a bare
monolith.

Rather than three independent migration slots (main Architecture, Database, Compute), we
introduced one shared `infra.pending` field. Only one change of any kind can be in flight at a
time, all three reuse the same cash-cost-plus-velocity-penalty mechanism at their own Tuning Table
scale, and the main Architecture axis was refactored onto it too (replacing the earlier
`migratingTo`/`migrationDaysLeft` pair).

## Consequences

- A player cannot stack cutovers -- swapping the database while migrating the compute model is not
  a way to hide one disruption inside another.
- Balancing a Sub-architecture switch means editing its own smaller Tuning Table entry, not a new
  mechanism.
- Save format bumped again (v4 -> v5) to carry the unified `pending` shape; the migration chain in
  `state.ts` grows by one more step rather than being redesigned.
