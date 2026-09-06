# The simulation is a pure core with React as a view

All game logic lived inside `page.tsx` (938 lines), with finance recalculation duplicated across
five separate handlers and the tick, LLM call, and command parsing interleaved. A campaign with
per-Stage Tuning Tables cannot be balanced by hand-playing it.

The simulation moves to a framework-free `src/sim/` exposing pure functions over one serialisable
state object: `tick(state, rng) -> state` and `apply(state, command) -> state`. React holds that
state and renders Telemetry; it owns no rules.

## Consequences

- Balance is measurable: a headless harness runs hundreds of Runs per Stage and reports win rate
  and median day, so Tuning Tables are edited against evidence rather than intuition.
- Save/load reduces to serialising the state object.
- The LLM sits outside the core entirely -- it only fills the Flavor Queue, and the core reads from it.
- The React layer becomes small enough that the CRT presentation work does not fight the rules.
