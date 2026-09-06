## Agent skills

### Issue tracker

Issues and specs live as local markdown files under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context repository layout. See `docs/agents/domain.md`.

### Grilling Protocol

- **ALWAYS run a grilling session with the user before making any code changes.**
- You must ask clarifying design questions and align on data models, behavior, and interaction rules before writing or modifying any code.


## Memory Store

This repository uses `@kovartravis/neuron` (globally linked as the `neuron` command) to persist learnings and task history.

Agents MUST invoke and strictly follow the `neuron-memory` skill at the beginning of every run (for context loading), at the end of every run (for memory recording), and during periodic maintenance (for clean & refresh).
