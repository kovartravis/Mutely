import { GameState } from './types';

export const MOCK_GAME_STATE: GameState = {
  companyName: 'NebulaStack Inc.',
  gameDayMs: 3000,
  currentDay: 47,
  gameStatus: 'running',

  finances: {
    cash: 487500,
    monthlyBurnRate: 28600,
    monthlyRevenue: 12400,
    activePenalties: 1200,
    runway: 28.3,
  },

  developers: [
    { id: 'd1', name: 'Ava Chen',      role: 'fullstack', level: 'senior', salary: 9500, velocity: 8, morale: 82, currentTicketId: 't2' },
    { id: 'd2', name: 'Marcus Webb',   role: 'backend',   level: 'mid',    salary: 7200, velocity: 6, morale: 61, currentTicketId: 't3' },
    { id: 'd3', name: 'Priya Nair',    role: 'frontend',  level: 'junior', salary: 5100, velocity: 4, morale: 90, currentTicketId: null },
    { id: 'd4', name: 'Jordan Riley',  role: 'devops',    level: 'mid',    salary: 6800, velocity: 5, morale: 45, currentTicketId: 't5' },
  ],

  candidates: [
    { id: 'c1', name: 'Sam Torres',   role: 'dba',      level: 'senior', salary: 10200, velocity: 7, blurb: 'Ex-Stripe DBA. Loves query optimization.' },
    { id: 'c2', name: 'Lee Nakamura', role: 'ml',       level: 'mid',    salary: 8800,  velocity: 5, blurb: 'Specializes in recommendation systems.' },
  ],

  tickets: [
    { id: 't1', title: 'User auth flow',               type: 'feature',   severity: 'high',     storyPoints: 5, revenueIncrease: 800,  revenuePenalty: 0,    status: 'done',        assignedTo: null,  progressPoints: 5,  description: 'Implement OAuth2 login.' },
    { id: 't2', title: 'Dashboard analytics widget',   type: 'feature',   severity: 'medium',   storyPoints: 8, revenueIncrease: 1200, revenuePenalty: 0,    status: 'in_progress', assignedTo: 'd1',  progressPoints: 3,  description: 'Real-time metric charts on the main dashboard.' },
    { id: 't3', title: 'Memory leak in auth service',  type: 'bug',       severity: 'critical', storyPoints: 3, revenueIncrease: 0,    revenuePenalty: 1200, status: 'in_progress', assignedTo: 'd2',  progressPoints: 1,  description: 'Auth service leaking 50MB/hr under load.' },
    { id: 't4', title: 'Refactor DB connection pool',  type: 'tech_debt', severity: 'medium',   storyPoints: 6, revenueIncrease: 400,  revenuePenalty: 0,    status: 'todo',        assignedTo: null,  progressPoints: 0,  description: 'Migrate to PgBouncer for connection pooling.' },
    { id: 't5', title: 'CI/CD pipeline setup',         type: 'feature',   severity: 'high',     storyPoints: 4, revenueIncrease: 600,  revenuePenalty: 0,    status: 'in_progress', assignedTo: 'd4',  progressPoints: 2,  description: 'GitHub Actions deploy pipeline to staging.' },
    { id: 't6', title: 'API rate limiting',            type: 'feature',   severity: 'low',      storyPoints: 3, revenueIncrease: 300,  revenuePenalty: 0,    status: 'backlog',     assignedTo: null,  progressPoints: 0,  description: 'Add per-user rate limits to public API.' },
    { id: 't7', title: 'Legacy session code',          type: 'tech_debt', severity: 'low',      storyPoints: 5, revenueIncrease: 200,  revenuePenalty: 0,    status: 'backlog',     assignedTo: null,  progressPoints: 0,  description: 'Remove deprecated session management code.' },
  ],

  loopHistory: [],

  llmConfig: {
    endpoint: 'https://api.openai.com/v1/chat/completions',
    apiKey: '',
    model: 'gpt-4o-mini',
    loopIntervalMs: 15000,
    contextTurns: 5,
    systemPrompt: '',
  },

  terminalHistory: [
    { type: 'event',  text: 'Day 46 — Market event: VC interest surge +$2,400 MRR (permanent)', timestamp: Date.now() - 90000 },
    { type: 'event',  text: 'Day 47 — Bug ticket added: Memory leak in auth service',           timestamp: Date.now() - 30000 },
    { type: 'input',  text: '/backlog',                                                          timestamp: Date.now() - 5000  },
    { type: 'output', text: 'Opening Kanban board...',                                           timestamp: Date.now() - 4900  },
  ],
};
