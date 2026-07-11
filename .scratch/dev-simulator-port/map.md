# Wayfinder Map: Dev Simulator Port

## Destination

Port the dev simulator game from scratch into a Next.js web application. The game features a real-time simulation where players manage a startup (hiring devs, backlog, roadmaps, funding, architecture) using a hybrid dashboard-terminal GUI, driven by a background LLM simulation loop parsing XML/JSON tool calls from the prompt body.

## Notes

- **Tech Stack**: Next.js, React, Tailwind CSS for modern styling and dashboards.
- **LLM Integration**: Next.js API route proxying to customizable LLM endpoints, utilizing prompt-based XML/JSON tool calling.
- **Operations**: Use `/wayfinder` to pick and work through tickets. Use `/prototype` for UI/UX exploration and `/domain-modeling` for data structures.

## Decisions so far

- [Game State Schema](issues/01-game-state-schema.md) — Finalized TypeScript types: `GameState`, `Developer` (roles incl. `dba`), `Ticket` (LLM-only; types: `feature | bug | tech_debt`), `Finances`, `LLMConfig`, `LLMSnapshot`, `LoopTurn`, `Candidate`. Revenue model: `revenueIncrease` (on done) + `revenuePenalty` (bugs, while open). Market events can be one-time cash or permanent MRR shifts. Dev quit reverts tickets to `todo`. Starting cash: $500k.
- [LLM Proxy API](issues/02-llm-proxy-api.md) — Implemented secure Next.js route handler proxy at `src/app/api/proxy/route.ts`. Supports access to local Wi-Fi / private subnet devices (e.g. Ollama, LM Studio) over HTTP, while enforcing HTTPS for public internet URLs, blocking loopback/localhost and link-local ranges, whitelisting headers, and supporting streaming.
- [Tool Calling Parser](issues/03-tool-calling-parser.md) — Implemented a robust XML-like parser at `src/lib/parser.ts` to convert LLM output tags (`add_ticket`, `add_bug_ticket`, `dev_applied`, `dev_quit`, `market_event`) into type-safe game action events. Supports double, single, and unquoted attributes, automatically handles type conversions, provides fallback values, and auto-generates candidate IDs.
- [Slash Command Engine](issues/05-slash-command-engine.md) — Implemented terminal slash command router in `src/app/page.tsx`. Parses inputs (`/backlog`, `/hire`, `/pause`, `/resume`, `/settings`, `/help`) to toggle overlays, modify game simulation statuses, or display/update detailed LLM proxy configuration properties with inline validations.
- [Dashboard Layout Prototype](issues/04-dashboard-layout-prototype.md) — Approved layout: Header → MetricCards → TeamPanel+RecentEvents → Terminal (20vh fixed). JetBrains Mono, dot-grid bg, role color badges, glow cards. `/hire` and `/backlog` slash commands wired. Prototype running at localhost:3000.




## Not yet specified

- **Roadmap & Architecture System**: How the roadmaps, tech debt, and architecture components affect the simulator state and backlog creation.
- **Funding & Investment Mechanics**: Scaling the game with venture capital, pitch decks, and investor milestones.
- **LLM Prompt Optimization**: Fine-tuning prompt structures to prevent Simple LLMs from producing invalid XML/JSON.
