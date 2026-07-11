import { LLMAction } from '../lib/types';
import { parseLLMResponse } from '../lib/parser';

// Define simulation state scenarios
export interface TestScenario {
  name: string;
  description: string;
  snapshot: any;
  validationRules: {
    minimumActions: number;
    expectedActionTypes?: string[];
    customValidate?: (actions: LLMAction[], rawText: string) => string | null;
  };
}

// 4 diverse game-state snapshots
export const SCENARIOS: TestScenario[] = [
  {
    name: 'Critical Bugs & Cash Strain',
    description: 'Low cash, high burn rate, multiple open critical bug tickets. Model should focus on developer applications, quitters due to high bug strain, or relief/market cash boosts.',
    snapshot: {
      day: 30,
      finances: {
        cash: 15000,
        monthlyBurnRate: 45000,
        monthlyRevenue: 10000,
        activePenalties: 6000,
        runway: 0.3
      },
      teamSize: 5,
      teamSummary: [
        { name: 'Ava Chen', role: 'fullstack', level: 'senior', workingOn: 'bug-1' },
        { name: 'Marcus Webb', role: 'backend', level: 'mid', workingOn: 'bug-2' },
        { name: 'Priya Nair', role: 'frontend', level: 'junior', workingOn: null },
        { name: 'Jordan Riley', role: 'devops', level: 'mid', workingOn: 'bug-3' },
        { name: 'Alex Kim', role: 'dba', level: 'senior', workingOn: null }
      ],
      openTickets: [
        { id: 'bug-1', title: 'Fatal OutOfMemory crash', type: 'bug', severity: 'critical', status: 'in_progress' },
        { id: 'bug-2', title: 'Database connection pool leakage', type: 'bug', severity: 'critical', status: 'in_progress' },
        { id: 'bug-3', title: 'CI/CD deployment failure', type: 'bug', severity: 'high', status: 'in_progress' }
      ],
      recentTurns: []
    },
    validationRules: {
      minimumActions: 1,
      customValidate: (actions) => {
        // Checking if we got any action helping relieve or adjust this high stress state
        const types = actions.map(a => a.type);
        if (types.includes('market_event') || types.includes('dev_quit') || types.includes('add_ticket')) {
          return null;
        }
        return 'Expected either a market event, developer quit due to stress, or feature/debt/bug tickets.';
      }
    }
  },
  {
    name: 'High Cash & Empty Backlog',
    description: 'High cash, zero active tickets. Model should generate new feature tickets and tech debt to keep the team busy.',
    snapshot: {
      day: 15,
      finances: {
        cash: 750000,
        monthlyBurnRate: 15000,
        monthlyRevenue: 28000,
        activePenalties: 0,
        runway: 50.0
      },
      teamSize: 3,
      teamSummary: [
        { name: 'Ava Chen', role: 'fullstack', level: 'senior', workingOn: null },
        { name: 'Priya Nair', role: 'frontend', level: 'junior', workingOn: null },
        { name: 'Marcus Webb', role: 'backend', level: 'mid', workingOn: null }
      ],
      openTickets: [],
      recentTurns: []
    },
    validationRules: {
      minimumActions: 1,
      expectedActionTypes: ['add_ticket'],
      customValidate: (actions) => {
        const addTicketActions = actions.filter(a => a.type === 'add_ticket');
        if (addTicketActions.length === 0) {
          return 'Expected at least one add_ticket action to populate the empty backlog.';
        }
        return null;
      }
    }
  },
  {
    name: 'Tiny Team & High Backlog',
    description: 'Lots of backlog tickets, only 1 developer. Model should generate developer applications to help the bottleneck.',
    snapshot: {
      day: 10,
      finances: {
        cash: 300000,
        monthlyBurnRate: 8000,
        monthlyRevenue: 5000,
        activePenalties: 0,
        runway: 37.5
      },
      teamSize: 1,
      teamSummary: [
        { name: 'Ava Chen', role: 'fullstack', level: 'senior', workingOn: 't1' }
      ],
      openTickets: [
        { id: 't1', title: 'User authentication', type: 'feature', severity: 'high', status: 'in_progress' },
        { id: 't2', title: 'Billing gateway integration', type: 'feature', severity: 'high', status: 'todo' },
        { id: 't3', title: 'Audit logging system', type: 'feature', severity: 'medium', status: 'todo' },
        { id: 't4', title: 'API rate limiter', type: 'feature', severity: 'medium', status: 'todo' },
        { id: 't5', title: 'Data warehousing storage', type: 'feature', severity: 'low', status: 'todo' }
      ],
      recentTurns: []
    },
    validationRules: {
      minimumActions: 1,
      customValidate: (actions) => {
        const devApplied = actions.filter(a => a.type === 'dev_applied');
        if (devApplied.length === 0) {
          return 'Expected at least one developer application (dev_applied) to assist the single developer.';
        }
        return null;
      }
    }
  },
  {
    name: 'Stable Operation & Regular Flow',
    description: 'Average cash, balanced backlog, active team. Model should generate a mix of regular features, tech debt, bug alerts, or market events.',
    snapshot: {
      day: 50,
      finances: {
        cash: 250000,
        monthlyBurnRate: 35000,
        monthlyRevenue: 40000,
        activePenalties: 1200,
        runway: 7.1
      },
      teamSize: 4,
      teamSummary: [
        { name: 'Ava Chen', role: 'fullstack', level: 'senior', workingOn: 't2' },
        { name: 'Marcus Webb', role: 'backend', level: 'mid', workingOn: 'bug-1' },
        { name: 'Priya Nair', role: 'frontend', level: 'junior', workingOn: null },
        { name: 'Jordan Riley', role: 'devops', level: 'mid', workingOn: 't5' }
      ],
      openTickets: [
        { id: 't2', title: 'Dashboard analytics', type: 'feature', severity: 'medium', status: 'in_progress' },
        { id: 'bug-1', title: 'Auth tokens expiration leak', type: 'bug', severity: 'high', status: 'in_progress' },
        { id: 't5', title: 'Pipeline scripts migration', type: 'tech_debt', severity: 'medium', status: 'in_progress' }
      ],
      recentTurns: []
    },
    validationRules: {
      minimumActions: 1
    }
  }
];
