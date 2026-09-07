# Work Mode is a forced choice at Seed, switchable later at real cost

The company must choose In-person or Remote the moment it enters Seed -- the game will not let the
clock advance again until it does. Each is a distinct system, not a shared dial with two labels:
In-person carries a single fictional Office City with its own rent, salary expectation, and
candidate pool, plus a headcount capacity that must be expanded to keep hiring past it. Remote
carries a set of independently-unlockable Countries, each with its own stats, plus an ongoing
Coordination Drag that grows with how many countries currently have an active hire.

The choice is switchable later, reusing the Migration pattern -- but unlike a Sub-architecture
switch, it also costs some current staff outright, immediately and non-retainably. Real people
don't want to be told their fully-remote job is becoming an office job, or vice versa; some leave.

## Consequences

- Two genuinely different data shapes coexist under one `workplace` field: Office is a single
  current City plus a capacity number; Remote is a set of unlocked Countries plus a derived Drag.
  They are not made to share a resource model the way Sub-architectures deliberately do.
- The reference player must make this choice too, immediately upon reaching Seed, or the harness
  stalls forever at the forced pause -- a real dependency the balance harness now carries.
- Relocating the Office to a different City, or unlocking a new remote Country, are both cheaper
  and non-disruptive compared to a full Work Mode switch -- only the mode itself carries the staff
  cost, since only the mode is the decision people would actually leave over.
