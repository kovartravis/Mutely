Type: prototype
Status: resolved

## Question

What should the hybrid TUI (Terminal User Interface) and Web Dashboard UI layout look like? We need a responsive React layout using Tailwind CSS featuring the financial health dashboard in the center, and a mock CLI terminal at the bottom.

## Answer

Prototype built and approved. Decisions locked:

- **Layout**: Header bar → 5 metric cards → Team panel (left, 62%) + Recent Events (right, 38%) → Fixed terminal (20vh)
- **Terminal**: Fixed height ~20vh, macOS-style traffic-light dots, tab autocomplete ghost text, ↑↓ command history, hint bar
- **Metric cards**: Cash, MRR, Burn Rate, Runway, Active Penalties — each with glow border matching its color
- **Role badges**: Colored pill per role — `frontend`=cyan, `backend`=green, `fullstack`=purple, `devops`=amber, `ml`=pink, `dba`=orange
- **Event colors**: bugs=red, features=cyan, market/VC=amber, tech_debt=purple (#c084fc)
- **Background**: Dot-grid pattern via CSS radial-gradient
- **Slash commands wired**: `/hire` opens candidate modal, `/backlog` opens Kanban board with 4 columns and move buttons
- **Kanban**: Backlog → To Do → In Progress → Done; ticket cards show type badge, severity, revenue delta, progress bar, move buttons
- **Hire modal**: Candidate cards with role badge, velocity dots (10-pip), salary, hire button that updates burn rate live
- **Font**: JetBrains Mono throughout
- **Color palette**: bg=#0d0f14, card=#161922, green=#00ff88, red=#ff4466, cyan=#00d4ff, amber=#ffaa00, purple=#c084fc
