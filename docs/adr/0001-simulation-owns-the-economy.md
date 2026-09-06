# The simulation owns the economy; the LLM owns the fiction

The original design let the LLM emit every economic quantity directly (`storyPoints="3"
revenueIncrease="500" salary="6000"`), with no validation. That makes the game impossible to
balance — difficulty becomes a property of whichever local model is loaded — and unplayable when
the endpoint is unreachable.

We inverted it. The simulation rolls all numbers from the current Stage's tuning tables, then asks
the LLM only to name and describe what it rolled. The LLM cannot author a quantity.

## Consequences

- Balance is a data table, editable and testable without a model in the loop.
- The game is fully playable with the LLM offline; it degrades to generic titles, not to a broken economy.
- The LLM call moves off the critical path — it becomes decoration applied to already-valid state.
- Narrative variety is now bounded by the sim's event vocabulary, not by the model's imagination.
