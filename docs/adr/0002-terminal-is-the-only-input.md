# The terminal is the only input surface

The game's core loop is assigning Developers to Tickets, which is conventionally a
direct-manipulation problem (drag a card onto a person). We deliberately rejected that. All state
changes go through typed Commands; the panels are read-only Telemetry.

This is a bet on identity: the game is about running an engineering org from a console, and a
drag-and-drop board would make it indistinguishable from project-management software.

## Consequences

- Discoverability is the primary design risk, and is paid for with live tab-completion over real
  game objects rather than a static command list.
- Every object needs a short stable Handle (`#a3`, `@marcus`) rendered on the Telemetry panels, so
  that reading the screen teaches the player what they can type.
- Every new mechanic must ship with command syntax, not just a control.
- The full-screen Kanban and Hire modals are removed; nothing ever covers the running game.
