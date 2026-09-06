# Infrastructure is a fourth Pressure, and Tech Debt now spans two

ADR-0001 through ADR-0003 established three Pressures, each mapped to exactly one mechanic:
Bugs -> Churn, Tech Debt -> Drag, salaries -> Cash. Adding infrastructure scaling broke that
symmetry deliberately, on the premise that legacy code doesn't scale cleanly: an open Tech Debt
ticket now also inflates the Capacity required to serve current Traffic, alongside its existing
Drag on Velocity. Running Over Capacity raises Churn through the same mechanism a Bug does.

We considered keeping the one-mechanic-per-Pressure rule intact by pricing Tech Debt's infra effect
as a flat cost surcharge instead (see the grilling session, 2026-09-05) -- simpler, and it would
have preserved the invariant. We rejected it: a flat surcharge explains why infrastructure is
*expensive* but not why it's *insufficient*, and "your ORM makes queries slow, so you need more
database replicas than the traffic alone would suggest" is the more legible story for why the
infra panel shows a shortfall the player didn't cause by under-buying.

## Consequences

- The "one Pressure per mechanic" rule in `CONTEXT.md` is no longer universal; Tech Debt is the
  documented exception, not a new pattern to repeat casually.
- Compute and Database are separate scalable resources, but architecture-specific: Nodes
  (kubernetes), Concurrency (serverless), or Tier (monolith) for compute; Database replicas are
  shared across all three, since a company needs a database regardless of its compute model.
- Efficiency is not a new stat. It reads team Proficiency in `devops` (compute) and `dba`
  (database) -- disciplines that already existed for ticket-matching and previously had no
  standing effect on the company. Hiring seniority there now pays off continuously, not just when
  an infra-flavored ticket happens to be open.
- Migrating Architecture is expensive and temporary-Velocity-costly by design, so it reads as a
  real strategic bet rather than a free re-roll of the cost curve.
