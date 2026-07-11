Type: task
Status: resolved
Blocked by: (none)

## Question

How should the terminal input parse slash commands (like `/hire`, `/backlog`) and trigger state modifications, rendering overlays, or display appropriate interactive modals?

## Answer

We have implemented robust slash command parsing and execution logic directly within the state system in [src/app/page.tsx](file:///root/Mutely/game/src/app/page.tsx).

### Command Parsing & Modal Triggering
- **Input Parsing**: Commands entered in the terminal trigger `handleCommand`, which cleans the input, splits it into arguments (`parts`), and performs base command routing via a switch-case statement.
- **Interactive Overlay Modals**:
  - `/backlog` sets the active modal state to `'kanban'`, which opens the **[KanbanBoard.tsx](file:///root/Mutely/game/src/components/KanbanBoard.tsx)** overlay component.
  - `/hire` sets the active modal state to `'hire'`, which opens the **[HireModal.tsx](file:///root/Mutely/game/src/components/HireModal.tsx)** developer recruitment dashboard.
- **Simulation Flow Control**:
  - `/pause` sets the game status to `'paused'`, stopping the simulation clock.
  - `/resume` sets the game status to `'running'`, resuming simulated progress.
- **LLM Settings Configuration**:
  - `/settings` (without arguments) outputs a detailed overview of current configurations (`endpoint`, masked `apiKey`, `model`, tick `interval`, context `turns`).
  - `/settings <key> <value>` parses and updates the matching parameter in `state.llmConfig`, including type validation for numerical parameters (`loopIntervalMs`, `contextTurns`).
- **Help Utility**:
  - `/help` outputs the complete menu of available commands, their structure, and description.
