Type: task
Status: resolved
Blocked by: 06

## Question

How do we implement the `/backlog` interactive Kanban board (showing Backlog, To Do, In Progress, and Done columns) and enable developer task assignment and progress rendering?

## Answer

We have implemented the Kanban board and developer assignment flow in [src/components/KanbanBoard.tsx](file:///root/Mutely/game/src/components/KanbanBoard.tsx) and [src/app/page.tsx](file:///root/Mutely/game/src/app/page.tsx).

### 1. Board Layout & Columns
- Typing `/backlog` launches the Kanban Board overlay modal.
- Includes four distinct columns: **Backlog**, **To Do**, **In Progress**, and **Done**.
- Mobile-optimized: Displays horizontal columns scaling to fit desktop screens, and smoothly scrolls columns horizontally on mobile/tablet widths ($\le 1024$px).

### 2. Task Assignment Mechanism
- Displays an interactive **ASSIGNED TO** dropdown selector inside each ticket card (visible in both `'todo'` and `'in_progress'` columns).
- Dropdown lists all active developers on the team along with their details (role, busy/idle status).
- Assigning a developer to a ticket automatically sets the ticket to `'in_progress'` status and locks the developer's assignment.
- Unassigning a developer (selecting "Unassigned") automatically reverts the ticket to `'todo'` status, freeing the developer.
- If a developer is reassigned to a new ticket, they are automatically unassigned from their previous ticket, and their previous ticket is returned to the `'todo'` column.
- Keeps track of completed ticket history by maintaining the developer's assignment ID on Done tickets, showing `"Completed by Marcus Webb"` in the Done column list.

### 3. Progress Tracking & Rewards
- Displays a visual progress percentage bar on cards in the In Progress column.
- Advancing ticket progress points daily ticks the simulation.
- Once completed, the ticket status changes to `'done'`, the developer is automatically unassigned to idle status (`currentTicketId = null`), and their morale is boosted if completing light feature tickets.
- MRR increases automatically by the ticket's `revenueIncrease` upon completion (or open bugs' `revenuePenalty` is removed), modifying net cash flows.
