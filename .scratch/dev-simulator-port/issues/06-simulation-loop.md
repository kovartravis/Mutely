Type: task
Status: resolved
Blocked by: 01, 02, 03, 05

## Question

How does the core real-time simulation loop tick game time, calculate monthly burn and income updates, and periodically run the background LLM loop to inject new backlog tasks and events?

## Answer

We have implemented the core real-time simulation loop and LLM feedback cycle within [src/app/page.tsx](file:///root/Mutely/game/src/app/page.tsx).

### 1. Core Day Ticking Loop
A `useEffect` hook triggers a periodic interval every `gameDayMs` (defaults to 3 seconds) when `gameStatus === 'running'`:
- Increments the day clock (`currentDay`).
- Iterates over developers. For any developer who has an assigned ticket (`currentTicketId !== null`), it applies their daily `velocity` value towards the ticket's `progressPoints`.
- When a ticket's `progressPoints` meet or exceed its `storyPoints`, the ticket status transitions to `'done'`, the developer returns to idle state (`currentTicketId = null`), and a success message is pushed to the terminal console log.

### 2. Monthly Financial Adjustments
At the end of every 30 simulated days:
- Calculates MRR from completed features (`status === 'done'`).
- Calculates Active Penalties from open bugs (`type === 'bug' && status !== 'done'`).
- Calculates monthly burn rate from hired developers' salaries.
- Adjusts cash: `cash += (monthlyRevenue - activePenalties - monthlyBurnRate)`.
- Triggers `game_over` bankruptcy status if cash reserves drop to/below 0, logging an error event.

### 3. Background LLM Consultation Loop
A second `useEffect` triggers an advisor consultation loop every `llmConfig.loopIntervalMs` real-time milliseconds (defaults to 15 seconds):
- Generates a type-safe `LLMSnapshot` containing current stats, financials, developer assignments, open ticket lists, and past history context.
- Calls `/api/proxy` to communicate with the configured LLM endpoint using `DEFAULT_SYSTEM_PROMPT` instructions.
- Parses XML tags using `parseLLMResponse` in `src/lib/parser.ts` to convert advisor responses into game state actions:
  - `add_ticket`: Inserts feature/tech debt tickets into backlog.
  - `add_bug_ticket`: Appends bug tickets to the To Do list.
  - `dev_applied`: Registers job applicants in the hiring board.
  - `dev_quit`: Removes developers from active staff and reverts their assigned ticket back to `'todo'`.
  - `market_event`: Modifies cash immediately, and if permanent, generates a virtual done feature ticket representing the permanent MRR delta.
- Safe-guarded against race conditions using a `useRef` lock preventing concurrent duplicate API advisor consults.
