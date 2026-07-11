// ─── Developer ───────────────────────────────────────────────────────────────

export type DeveloperRole = 'frontend' | 'backend' | 'fullstack' | 'devops' | 'ml' | 'dba';
export type DeveloperLevel = 'junior' | 'mid' | 'senior' | 'staff';

export interface Developer {
  id: string;
  name: string;
  role: DeveloperRole;
  level: DeveloperLevel;
  salary: number;
  velocity: number;       // story points per game-day (1–10)
  morale: number;         // 0–100
  currentTicketId: string | null;
}

// ─── Candidate ───────────────────────────────────────────────────────────────

export interface Candidate {
  id: string;
  name: string;
  role: DeveloperRole;
  level: DeveloperLevel;
  salary: number;
  velocity: number;
  blurb: string;
}

// ─── Ticket ───────────────────────────────────────────────────────────────────

export type TicketType = 'feature' | 'bug' | 'tech_debt';
export type TicketSeverity = 'low' | 'medium' | 'high' | 'critical';
export type TicketStatus = 'backlog' | 'todo' | 'in_progress' | 'done';

export interface Ticket {
  id: string;
  title: string;
  description: string;
  type: TicketType;
  severity: TicketSeverity;
  storyPoints: number;
  revenueIncrease: number;    // monthly MRR delta upon completion
  revenuePenalty: number;     // monthly MRR penalty while open (bugs only)
  status: TicketStatus;
  assignedTo: string | null;  // Developer.id
  progressPoints: number;
}

// ─── Finances ────────────────────────────────────────────────────────────────

export interface Finances {
  cash: number;
  monthlyBurnRate: number;
  monthlyRevenue: number;
  activePenalties: number;
  runway: number;             // derived: cash / (burnRate - revenue + activePenalties)
}

// ─── LLM / Loop ──────────────────────────────────────────────────────────────

export type LLMActionType = 'add_ticket' | 'add_bug_ticket' | 'dev_applied' | 'dev_quit' | 'market_event';

export type LLMAction =
  | { type: 'add_ticket';    payload: Omit<Ticket, 'id' | 'status' | 'assignedTo' | 'progressPoints'> }
  | { type: 'add_bug_ticket'; payload: Omit<Ticket, 'id' | 'status' | 'assignedTo' | 'progressPoints'> }
  | { type: 'dev_applied';   payload: Candidate }
  | { type: 'dev_quit';      payload: { developerId: string; reason: string } }
  | { type: 'market_event';  payload: { headline: string; revenueEffect: number; cashEffect: number; permanent: boolean } };

export interface LoopTurn {
  turnIndex: number;
  rawResponse: string;
  parsedActions: LLMAction[];
  timestamp: number;
}

export interface LLMConfig {
  endpoint: string;
  apiKey: string;
  model: string;
  loopIntervalMs: number;
  contextTurns: number;
  systemPrompt: string;
}

export interface LLMSnapshot {
  day: number;
  finances: Finances;
  teamSize: number;
  teamSummary: Array<{ name: string; role: string; level: string; workingOn: string | null }>;
  openTickets: Array<{ id: string; title: string; type: string; severity: string; status: string }>;
  recentTurns: LoopTurn[];
}

// ─── Terminal ────────────────────────────────────────────────────────────────

export type TerminalLineType = 'input' | 'output' | 'error' | 'event';

export interface TerminalLine {
  type: TerminalLineType;
  text: string;
  timestamp: number;
}

// ─── GameState ───────────────────────────────────────────────────────────────

export type GameStatus = 'running' | 'paused' | 'game_over';

export interface GameState {
  companyName: string;
  gameDayMs: number;
  currentDay: number;
  developers: Developer[];
  candidates: Candidate[];
  tickets: Ticket[];
  finances: Finances;
  loopHistory: LoopTurn[];
  llmConfig: LLMConfig;
  terminalHistory: TerminalLine[];
  gameStatus: GameStatus;
}
