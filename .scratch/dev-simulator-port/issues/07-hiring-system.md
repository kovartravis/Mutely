Type: task
Status: resolved
Blocked by: 06

## Question

How should the `/hire` slash command load the hiring candidate selection modal, generate random candidate pools with distinct stats/salaries, and allow the user to add them to their active team?

## Answer

We have implemented the hiring and developer management systems in [src/app/page.tsx](file:///root/Mutely/game/src/app/page.tsx), [src/components/HireModal.tsx](file:///root/Mutely/game/src/components/HireModal.tsx), and [src/components/Terminal.tsx](file:///root/Mutely/game/src/components/Terminal.tsx).

### 1. Recruiting & Hiring
- **LLM-Driven Applicants**: When the background LLM loop triggers `<dev_applied>` actions, applicants are loaded into the candidates pool with distinct stats (name, level, role, velocity, salary expectation, blurb).
- **Hiring Action**: Typing `/hire` opens the hiring dashboard modal where the user can view applicants and click **HIRE**. Hiring a developer shifts them from `candidates` to the active `developers` list, immediately recalculating the recurring `monthlyBurnRate` without upfront sign-on fees.

### 2. Developer Morale & Productivity Ticks
- **Work Overload**: Ticking days triggers morale decays for stressful tasks:
  - Working on a `'critical'` severity bug decays dev morale by **3 points** per day.
  - Working on a `'high'` severity ticket (feature, bug, or tech debt) decays morale by **1 point** per day.
- **R&R Recovery**: Idle developers (with no current ticket assignment) recover morale by **2 points** per day (capped at `100`).
- **Success Morale Boost**: Completing any low-severity feature ticket successfully boosts that developer's morale by **+10 points**.
- **Morale Warnings**: When a developer's morale drops below **30** (transitioning from $\ge 30$ to $<30$), the console logs a high-priority terminal warning alert (e.g. `Warning: Marcus Webb's morale is critical (29)!`).
- **Morale Impact on Velocity**: Lower morale decreases developer productivity daily:
  $$\text{Effective Velocity} = \max\left(1, \text{round}\left(\text{Velocity} \times \frac{\text{Morale}}{100}\right)\right)$$

### 3. Active Morale Boost Commands
Two new terminal commands have been added to manually manage developer morale in the team:
- `/raise <dev_name> <increase_amount>`: Permanently increases the developer's monthly salary and boosts morale ($\text{morale} += \text{increase\_amount} \times 0.04$).
- `/bonus <dev_name> <cash_amount>`: Deducts a one-time cash bonus from corporate reserves, boosting morale ($\text{morale} += \text{cash\_amount} \times 0.01$).

### 4. Role Matching (Velocity Penalty)
If a developer is assigned to a ticket outside their domain, they suffer a **50% velocity penalty**. The system dynamically checks title/description keywords against their role:
- `'frontend'`: *ui, ux, widget, css, html, react, component, button, page, modal, styles, layout*
- `'backend'`: *backend, api, auth, login, server, service, route, controller, endpoints, session, jwt*
- `'dba'`: *database, db, query, sql, migration, postgres, pool, index, queries, schema*
- `'devops'`: *devops, ci, cd, pipeline, docker, aws, deploy, actions, kubernetes, infra, infrastructure, host*
- `'ml'`: *ml, ai, model, training, recommendation, prediction, neural, prompt, llm*
- `'fullstack'`: matches all domains (no penalty).
