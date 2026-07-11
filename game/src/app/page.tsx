'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { MOCK_GAME_STATE } from '@/lib/mockData';
import { GameState, TicketStatus, TerminalLine, LLMSnapshot, LoopTurn, GameStatus } from '@/lib/types';
import { parseLLMResponse } from '@/lib/parser';
import Header from '@/components/Header';
import MetricCards from '@/components/MetricCards';
import TeamPanel from '@/components/TeamPanel';
import RecentEvents from '@/components/RecentEvents';
import Terminal from '@/components/Terminal';
import KanbanBoard from '@/components/KanbanBoard';
import HireModal from '@/components/HireModal';

type Modal = 'none' | 'kanban' | 'hire';

const DEFAULT_SYSTEM_PROMPT = `You are NebulaStack's AI Board Advisor. You monitor the company state and trigger events using XML tags.
You MUST output a short narrative paragraph summarizing your analysis, followed by one or more action tags:

XML Actions:
- Add feature or tech debt: <add_ticket title="Title" type="feature|tech_debt" severity="low|medium|high|critical" storyPoints="3" revenueIncrease="500" />
- Add bug ticket: <add_bug_ticket title="Title" severity="high" storyPoints="2" revenuePenalty="200" />
- Developer applies to join team: <dev_applied name="Name" role="frontend|backend|fullstack|devops|ml|dba" level="junior|mid|senior|staff" salary="6000" velocity="5" blurb="Candidate bio..." />
- Developer quit: <dev_quit developerId="id" reason="Reason..." /> (only use valid IDs from the active team)
- Market event: <market_event headline="Headline" revenueEffect="1000" cashEffect="-5000" permanent="true" /> (permanent=true changes MRR, permanent=false is one-time cash)

Keep events relevant, challenging, and realistic based on current cash, MRR, and tickets backlog.`;

const getLLMSnapshot = (state: GameState): LLMSnapshot => {
  return {
    day: state.currentDay,
    finances: state.finances,
    teamSize: state.developers.length,
    teamSummary: state.developers.map(d => ({
      name: d.name,
      role: d.role,
      level: d.level,
      workingOn: d.currentTicketId,
    })),
    openTickets: state.tickets
      .filter(t => t.status !== 'done')
      .map(t => ({
        id: t.id,
        title: t.title,
        type: t.type,
        severity: t.severity,
        status: t.status,
      })),
    recentTurns: state.loopHistory.slice(-state.llmConfig.contextTurns),
  };
};

function getGameCriticalInstructions(state: GameState): string {
  let contextNotes = '';
  
  const openTicketsCount = state.tickets.filter(t => t.status !== 'done').length;
  const hasCriticalBugs = state.tickets.some(t => t.type === 'bug' && t.severity === 'critical' && t.status !== 'done');
  const teamSize = state.developers.length;
  const cash = state.finances.cash;
  const runway = state.finances.runway;
  
  if (cash < 50000 || runway < 1.0) {
    contextNotes += `- [STATUS] Cash reserves are low. Trigger a <market_event> to inject cash, or a developer candidate <dev_applied> to recruit help.\n`;
  }
  if (hasCriticalBugs) {
    contextNotes += `- [STATUS] The system has active critical bugs. Developers working on them will suffer morale decay. Generate developer candidates or simulate developer resignations via <dev_quit> to reflect staff strain.\n`;
  }
  if (openTicketsCount === 0) {
    contextNotes += `- [STATUS] The backlog is empty. You MUST generate at least one new feature or tech debt ticket using <add_ticket title="..." type="feature" severity="medium" storyPoints="5" revenueIncrease="800" />.\n`;
  }
  if (teamSize === 1 && openTicketsCount > 2) {
    contextNotes += `- [STATUS] The team size is extremely small relative to the backlog workload. You MUST output a developer application using <dev_applied> to recruit help.\n`;
  }
  
  return `
<CRITICAL_INSTRUCTION>
- You MUST output a short narrative paragraph summarizing your analysis, followed by one or more action tags.
- Always output actual XML action tags (e.g. <add_ticket ... /> or <dev_applied ... />). Ensure all tags are properly formed and terminated with a closing slash before the bracket (/>).
- Do NOT output tickets with identical titles to the ones already open.
${contextNotes || '- Continue normal simulator operations, generating balanced features, tech debt, bug alerts, or market events.'}
</CRITICAL_INSTRUCTION>`;
}

function isRoleMatching(devRole: string, title: string, desc: string): boolean {
  if (devRole === 'fullstack') return true;
  
  const content = (title + ' ' + desc).toLowerCase();
  
  switch (devRole) {
    case 'frontend':
      return /frontend|ui|ux|widget|css|html|react|component|button|page|modal|styles|layout/i.test(content);
    case 'backend':
      return /backend|api|auth|login|server|service|route|controller|endpoints|session|jwt/i.test(content);
    case 'dba':
      return /database|db|query|sql|migration|postgres|pool|index|queries|schema/i.test(content);
    case 'devops':
      return /devops|ci|cd|pipeline|docker|aws|deploy|actions|kubernetes|infra|infrastructure|host/i.test(content);
    case 'ml':
      return /ml|ai|model|training|recommendation|prediction|neural|prompt|llm/i.test(content);
    default:
      return true;
  }
}

export default function GamePage() {
  const [state, setState] = useState<GameState>(MOCK_GAME_STATE);
  const [modal, setModal] = useState<Modal>('none');

  const pushLine = useCallback((line: Omit<TerminalLine, 'timestamp'>) => {
    setState(prev => ({
      ...prev,
      terminalHistory: [...prev.terminalHistory, { ...line, timestamp: Date.now() }],
    }));
  }, []);

  const handleCommand = useCallback((cmd: string) => {
    pushLine({ type: 'input', text: cmd });

    const parts = cmd.trim().toLowerCase().split(/\s+/);
    const base = parts[0];

    switch (base) {
      case '/backlog':
        setModal('kanban');
        pushLine({ type: 'output', text: 'Opening Kanban board...' });
        break;

      case '/hire':
        setModal('hire');
        pushLine({ type: 'output', text: 'Opening hiring dashboard...' });
        break;

      case '/pause':
        setState(prev => ({ ...prev, gameStatus: 'paused' }));
        pushLine({ type: 'output', text: 'Simulation paused.' });
        break;

      case '/resume':
        setState(prev => ({ ...prev, gameStatus: 'running' }));
        pushLine({ type: 'output', text: 'Simulation resumed.' });
        break;

      case '/help':
        pushLine({ type: 'output', text: 'Available commands:' });
        pushLine({ type: 'output', text: '  /backlog              - Open the interactive Kanban backlog board' });
        pushLine({ type: 'output', text: '  /hire                 - Open the developer hiring dashboard' });
        pushLine({ type: 'output', text: '  /pause                - Pause simulated game time' });
        pushLine({ type: 'output', text: '  /resume               - Resume simulated game time' });
        pushLine({ type: 'output', text: '  /raise <name> <amt>   - Give a developer a monthly raise to boost morale' });
        pushLine({ type: 'output', text: '  /bonus <name> <amt>   - Give a developer a one-time cash bonus to boost morale' });
        pushLine({ type: 'output', text: '  /settings             - View current LLM simulator configurations' });
        pushLine({ type: 'output', text: '  /settings <key> <val> - Change configurations (keys: endpoint, apiKey, model, interval, turns)' });
        pushLine({ type: 'output', text: '  /help                 - Display this commands directory' });
        break;

      case '/raise': {
        if (parts.length < 3) {
          pushLine({ type: 'error', text: 'Usage: /raise <developer_name> <monthly_increase_amount>' });
          break;
        }
        const search = parts[1].toLowerCase();
        const amount = parseInt(parts[2], 10);
        if (isNaN(amount) || amount <= 0) {
          pushLine({ type: 'error', text: 'Error: Invalid raise amount. Must be a positive number.' });
          break;
        }

        setState(prev => {
          const devIdx = prev.developers.findIndex(d => 
            d.id.toLowerCase() === search || d.name.toLowerCase().includes(search)
          );
          if (devIdx === -1) {
            return {
              ...prev,
              terminalHistory: [...prev.terminalHistory, { type: 'error', text: `Error: Developer "${parts[1]}" not found.`, timestamp: Date.now() }]
            };
          }
          
          const dev = prev.developers[devIdx];
          const newSalary = dev.salary + amount;
          const newMorale = Math.min(100, dev.morale + Math.round((amount / 100) * 4));
          
          const updatedDevs = prev.developers.map((d, idx) => 
            idx === devIdx ? { ...d, salary: newSalary, morale: newMorale } : d
          );
          
          const monthlyBurnRate = updatedDevs.reduce((sum, d) => sum + d.salary, 0);
          const runway = prev.finances.cash / Math.max(monthlyBurnRate - prev.finances.monthlyRevenue + prev.finances.activePenalties, 1);
          
          return {
            ...prev,
            developers: updatedDevs,
            finances: {
              ...prev.finances,
              monthlyBurnRate,
              runway
            },
            terminalHistory: [...prev.terminalHistory, { type: 'event', text: `Day ${prev.currentDay} — Gave ${dev.name} a $${amount}/mo raise. New salary: $${newSalary}/mo. Morale: ${newMorale}%`, timestamp: Date.now() }]
          };
        });
        break;
      }

      case '/bonus': {
        if (parts.length < 3) {
          pushLine({ type: 'error', text: 'Usage: /bonus <developer_name> <one_time_amount>' });
          break;
        }
        const search = parts[1].toLowerCase();
        const amount = parseInt(parts[2], 10);
        if (isNaN(amount) || amount <= 0) {
          pushLine({ type: 'error', text: 'Error: Invalid bonus amount. Must be a positive number.' });
          break;
        }

        setState(prev => {
          const devIdx = prev.developers.findIndex(d => 
            d.id.toLowerCase() === search || d.name.toLowerCase().includes(search)
          );
          if (devIdx === -1) {
            return {
              ...prev,
              terminalHistory: [...prev.terminalHistory, { type: 'error', text: `Error: Developer "${parts[1]}" not found.`, timestamp: Date.now() }]
            };
          }
          
          const dev = prev.developers[devIdx];
          if (prev.finances.cash < amount) {
            return {
              ...prev,
              terminalHistory: [...prev.terminalHistory, { type: 'error', text: 'Error: Insufficient cash reserves to pay this bonus.', timestamp: Date.now() }]
            };
          }

          const newMorale = Math.min(100, dev.morale + Math.round((amount / 500) * 5));
          const updatedDevs = prev.developers.map((d, idx) => 
            idx === devIdx ? { ...d, morale: newMorale } : d
          );
          
          const newCash = prev.finances.cash - amount;
          const runway = newCash / Math.max(prev.finances.monthlyBurnRate - prev.finances.monthlyRevenue + prev.finances.activePenalties, 1);
          
          return {
            ...prev,
            developers: updatedDevs,
            finances: {
              ...prev.finances,
              cash: newCash,
              runway
            },
            terminalHistory: [...prev.terminalHistory, { type: 'event', text: `Day ${prev.currentDay} — Paid ${dev.name} a $${amount.toLocaleString()} cash bonus. Morale: ${newMorale}%`, timestamp: Date.now() }]
          };
        });
        break;
      }

      case '/settings': {
        if (parts.length === 1) {
          pushLine({ type: 'output', text: 'Current LLM Configuration:' });
          pushLine({ type: 'output', text: `  endpoint: ${state.llmConfig.endpoint || '(not set)'}` });
          pushLine({ type: 'output', text: `  apiKey:   ${state.llmConfig.apiKey ? '••••••••••••' : '(not set)'}` });
          pushLine({ type: 'output', text: `  model:    ${state.llmConfig.model || '(not set)'}` });
          pushLine({ type: 'output', text: `  interval: ${state.llmConfig.loopIntervalMs}ms` });
          pushLine({ type: 'output', text: `  turns:    ${state.llmConfig.contextTurns}` });
          pushLine({ type: 'output', text: 'Update setting using: /settings <key> <value> (e.g. /settings model gpt-4o)' });
        } else {
          const key = parts[1];
          const value = cmd.trim().slice(cmd.indexOf(key) + key.length).trim();
          
          if (!value) {
            pushLine({ type: 'error', text: `Error: Missing value for setting key "${key}"` });
            break;
          }

          let updatedKey = '';
          let parsedValue: any = value;
          let isValid = true;

          if (key === 'endpoint') {
            updatedKey = 'endpoint';
          } else if (key === 'apikey' || key === 'api_key') {
            updatedKey = 'apiKey';
          } else if (key === 'model') {
            updatedKey = 'model';
          } else if (key === 'interval' || key === 'loopintervalms') {
            const ms = parseInt(value, 10);
            if (isNaN(ms) || ms <= 0) {
              pushLine({ type: 'error', text: `Error: Invalid interval value "${value}" (must be positive number)` });
              isValid = false;
            } else {
              updatedKey = 'loopIntervalMs';
              parsedValue = ms;
            }
          } else if (key === 'turns' || key === 'contextturns') {
            const turns = parseInt(value, 10);
            if (isNaN(turns) || turns < 0) {
              pushLine({ type: 'error', text: `Error: Invalid turns value "${value}" (must be 0 or positive)` });
              isValid = false;
            } else {
              updatedKey = 'contextTurns';
              parsedValue = turns;
            }
          } else {
            pushLine({ type: 'error', text: `Error: Unknown settings key "${key}". Supported: endpoint, apiKey, model, interval, turns` });
            isValid = false;
          }

          if (isValid && updatedKey) {
            setState(prev => ({
              ...prev,
              llmConfig: {
                ...prev.llmConfig,
                [updatedKey]: parsedValue
              }
            }));
            const displayVal = updatedKey === 'apiKey' ? '••••••••••••' : value;
            pushLine({ type: 'output', text: `Setting "${updatedKey}" successfully updated to: ${displayVal}` });
          }
        }
        break;
      }

      default:
        pushLine({ type: 'error', text: `Unknown command: "${cmd}". Type /help for available commands.` });
    }
  }, [pushLine]);

  const handleMoveTicket = useCallback((ticketId: string, newStatus: TicketStatus) => {
    setState(prev => {
      const tickets = prev.tickets.map(t => {
        if (t.id !== ticketId) return t;
        // If moved away from in_progress, unassign
        const assignedTo = newStatus === 'in_progress' ? t.assignedTo : newStatus === 'done' ? t.assignedTo : null;
        return { ...t, status: newStatus, assignedTo };
      });

      // Recalculate active penalties
      const activePenalties = tickets
        .filter(t => t.type === 'bug' && t.status !== 'done')
        .reduce((sum, t) => sum + t.revenuePenalty, 0);

      // Recalculate MRR (base + done features)
      const doneRevenue = tickets
        .filter(t => t.status === 'done')
        .reduce((sum, t) => sum + t.revenueIncrease, 0);

      const monthlyRevenue = doneRevenue;
      const { monthlyBurnRate, cash } = prev.finances;
      const runway = cash / Math.max(monthlyBurnRate - monthlyRevenue + activePenalties, 1);

      return {
        ...prev,
        tickets,
        finances: { ...prev.finances, activePenalties, monthlyRevenue, runway },
      };
    });

    const ticket = state.tickets.find(t => t.id === ticketId);
    if (ticket) {
      pushLine({ type: 'event', text: `Ticket moved → ${newStatus.replace('_', ' ')}: "${ticket.title}"` });
    }
  }, [state.tickets, pushLine]);

  const handleHire = useCallback((candidateId: string) => {
    setState(prev => {
      const candidate = prev.candidates.find(c => c.id === candidateId);
      if (!candidate) return prev;

      const newDev = {
        id: `d${Date.now()}`,
        name: candidate.name,
        role: candidate.role,
        level: candidate.level,
        salary: candidate.salary,
        velocity: candidate.velocity,
        morale: 100,
        currentTicketId: null,
      };

      const candidates = prev.candidates.filter(c => c.id !== candidateId);
      const monthlyBurnRate = prev.finances.monthlyBurnRate + candidate.salary;
      const runway = prev.finances.cash / Math.max(monthlyBurnRate - prev.finances.monthlyRevenue + prev.finances.activePenalties, 1);

      return {
        ...prev,
        candidates,
        developers: [...prev.developers, newDev],
        finances: { ...prev.finances, monthlyBurnRate, runway },
      };
    });

    const candidate = state.candidates.find(c => c.id === candidateId);
    if (candidate) {
      pushLine({ type: 'event', text: `Hired ${candidate.name} (${candidate.role}, ${candidate.level})` });
      setModal('none');
    }
  }, [state.candidates, pushLine]);

  const handleAssignDeveloper = useCallback((ticketId: string, developerId: string | null) => {
    setState(prev => {
      // Find the ticket first to check its status
      const ticket = prev.tickets.find(t => t.id === ticketId);
      if (!ticket) return prev;

      // 1. Update developers
      const updatedDevs = prev.developers.map(d => {
        // If this developer is being assigned to the ticket
        if (developerId && d.id === developerId) {
          return { ...d, currentTicketId: ticketId };
        }
        // If this developer was previously assigned to this ticket, unassign them
        if (d.currentTicketId === ticketId) {
          return { ...d, currentTicketId: null };
        }
        return d;
      });

      // 2. Update tickets: set assignedTo and change status to 'in_progress' if assigned, or 'todo' if unassigned
      const updatedTickets = prev.tickets.map(t => {
        if (t.id !== ticketId) return t;

        const newStatus = developerId ? ('in_progress' as const) : ('todo' as const);
        return {
          ...t,
          assignedTo: developerId,
          status: newStatus,
        };
      });

      // Recalculate finances
      const activePenalties = updatedTickets
        .filter(t => t.type === 'bug' && t.status !== 'done')
        .reduce((sum, t) => sum + t.revenuePenalty, 0);

      const monthlyRevenue = updatedTickets
        .filter(t => t.status === 'done')
        .reduce((sum, t) => sum + t.revenueIncrease, 0);

      const monthlyBurnRate = updatedDevs.reduce((sum, d) => sum + d.salary, 0);
      const runway = prev.finances.cash / Math.max(monthlyBurnRate - monthlyRevenue + activePenalties, 1);

      const dev = prev.developers.find(d => d.id === developerId);
      const newTerminalLines: TerminalLine[] = [];
      if (developerId && dev) {
        newTerminalLines.push({ type: 'event', text: `Assigned ${dev.name} to ticket "${ticket.title}"`, timestamp: Date.now() });
      } else {
        newTerminalLines.push({ type: 'event', text: `Unassigned ticket "${ticket.title}"`, timestamp: Date.now() });
      }

      return {
        ...prev,
        developers: updatedDevs,
        tickets: updatedTickets,
        finances: {
          ...prev.finances,
          activePenalties,
          monthlyRevenue,
          monthlyBurnRate,
          runway,
        },
        terminalHistory: [...prev.terminalHistory, ...newTerminalLines]
      };
    });
  }, []);

  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const isLLMLoopRunningRef = useRef(false);

  // Core day-ticking loop
  useEffect(() => {
    if (state.gameStatus !== 'running') return;

    const interval = setInterval(() => {
      setState(prev => {
        if (prev.gameStatus !== 'running') return prev;

        const newDay = prev.currentDay + 1;
        let newCash = prev.finances.cash;
        let newGameStatus: GameStatus = prev.gameStatus;
        const newTerminalLines: TerminalLine[] = [];

        // Calculate monthly burn
        const monthlyBurnRate = prev.developers.reduce((sum, d) => sum + d.salary, 0);

        // Process developer work
        let updatedTickets = [...prev.tickets];
        let updatedDevs = prev.developers.map(dev => {
          if (!dev.currentTicketId) {
            // Recover morale by 2 points per day
            const newMorale = Math.min(100, dev.morale + 2);
            return { ...dev, morale: newMorale };
          }
          
          const ticketIdx = updatedTickets.findIndex(t => t.id === dev.currentTicketId);
          if (ticketIdx === -1) {
            return { ...dev, currentTicketId: null, morale: Math.min(100, dev.morale + 2) };
          }
          
          const ticket = updatedTickets[ticketIdx];
          if (ticket.status !== 'in_progress') {
            const newMorale = Math.min(100, dev.morale + 2);
            return { ...dev, morale: newMorale };
          }

          // Active work progress and morale decay
          const prevMorale = dev.morale;
          let decayRate = 0;
          if (ticket.type === 'bug' && ticket.severity === 'critical') {
            decayRate = 3;
          } else if (ticket.severity === 'high') {
            decayRate = 1;
          }

          const newMorale = Math.max(0, prevMorale - decayRate);
          
          if (prevMorale >= 30 && newMorale < 30) {
            newTerminalLines.push({
              type: 'error',
              text: `Warning: ${dev.name}'s morale is critical (${newMorale})!`,
              timestamp: Date.now(),
            });
          }

          // Calculate effective velocity
          let baseVelocity = dev.velocity * (newMorale / 100);
          if (!isRoleMatching(dev.role, ticket.title, ticket.description)) {
            baseVelocity *= 0.5;
          }
          const effectiveVelocity = Math.max(1, Math.round(baseVelocity));

          const nextProgress = ticket.progressPoints + effectiveVelocity;
          if (nextProgress >= ticket.storyPoints) {
            // Complete ticket
            updatedTickets[ticketIdx] = {
              ...ticket,
              status: 'done',
              progressPoints: ticket.storyPoints,
            };
            
            let moraleBoost = 0;
            if (ticket.type === 'feature' && ticket.severity === 'low') {
              moraleBoost = 10;
            }
            const finalMorale = Math.min(100, newMorale + moraleBoost);

            newTerminalLines.push({
              type: 'event',
              text: `Day ${newDay} — Completed ${ticket.type === 'bug' ? 'bug' : ticket.type === 'tech_debt' ? 'tech debt' : 'feature'}: "${ticket.title}" (+$${ticket.revenueIncrease}/mo MRR)`,
              timestamp: Date.now(),
            });
            
            return { ...dev, currentTicketId: null, morale: finalMorale };
          } else {
            // Progress ticket
            updatedTickets[ticketIdx] = {
              ...ticket,
              progressPoints: nextProgress,
            };
            return { ...dev, morale: newMorale };
          }
        });

        // Recalculate finances
        const activePenalties = updatedTickets
          .filter(t => t.type === 'bug' && t.status !== 'done')
          .reduce((sum, t) => sum + t.revenuePenalty, 0);

        const monthlyRevenue = updatedTickets
          .filter(t => t.status === 'done')
          .reduce((sum, t) => sum + t.revenueIncrease, 0);

        const netFlow = monthlyRevenue - activePenalties - monthlyBurnRate;

        // Pay salaries and earn revenue at end of month
        if (newDay % 30 === 0) {
          newCash += netFlow;
          newTerminalLines.push({
            type: 'event',
            text: `Day ${newDay} — Monthly Financials: Cash: $${newCash.toLocaleString()} (Net: ${netFlow >= 0 ? '+' : ''}$${netFlow.toLocaleString()}/mo)`,
            timestamp: Date.now(),
          });

          if (newCash <= 0) {
            newGameStatus = 'game_over';
            newTerminalLines.push({
              type: 'error',
              text: `Day ${newDay} — BANKRUPTCY! Company has run out of cash. Game Over.`,
              timestamp: Date.now(),
            });
          }
        }

        const runway = newCash / Math.max(monthlyBurnRate - monthlyRevenue + activePenalties, 1);

        return {
          ...prev,
          currentDay: newDay,
          developers: updatedDevs,
          tickets: updatedTickets,
          gameStatus: newGameStatus,
          finances: {
            cash: newCash,
            monthlyBurnRate,
            monthlyRevenue,
            activePenalties,
            runway,
          },
          terminalHistory: [...prev.terminalHistory, ...newTerminalLines],
        };
      });
    }, state.gameDayMs);

    return () => clearInterval(interval);
  }, [state.gameStatus, state.gameDayMs]);

  // Background Advisor LLM loop triggers
  const triggerLLMLoop = useCallback(async () => {
    if (isLLMLoopRunningRef.current) return;
    const currentState = stateRef.current;
    if (currentState.gameStatus !== 'running') return;

    const { endpoint, apiKey, model, systemPrompt } = currentState.llmConfig;
    if (!endpoint) {
      pushLine({ type: 'error', text: 'LLM Loop Error: Endpoint is not configured in settings.' });
      return;
    }

    isLLMLoopRunningRef.current = true;
    pushLine({ type: 'output', text: 'Consulting AI Board Advisor...' });

    try {
      const snapshot = getLLMSnapshot(currentState);
      const criticalInstructions = getGameCriticalInstructions(currentState);
      const messages = [
        { role: 'system', content: systemPrompt || DEFAULT_SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(snapshot, null, 2) + '\n\n' + criticalInstructions }
      ];

      const response = await fetch('/api/proxy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          endpoint,
          headers: apiKey ? { 'authorization': `Bearer ${apiKey}` } : {},
          body: {
            model,
            messages,
            temperature: 0.7,
          }
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Status ${response.status}: ${errText}`);
      }

      const data = await response.json();
      const rawResponse = data.choices?.[0]?.message?.content || '';

      if (!rawResponse) {
        throw new Error('Empty response from LLM');
      }

      const parsedActions = parseLLMResponse(rawResponse);

      setState(prev => {
        let updatedTickets = [...prev.tickets];
        let updatedDevelopers = [...prev.developers];
        let updatedCandidates = [...prev.candidates];
        let updatedCash = prev.finances.cash;
        const newTerminalLines: TerminalLine[] = [];

        parsedActions.forEach(action => {
          switch (action.type) {
            case 'add_ticket': {
              const newTicket = {
                ...action.payload,
                id: `t-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
                status: 'backlog' as const,
                assignedTo: null,
                progressPoints: 0,
              };
              updatedTickets.push(newTicket);
              newTerminalLines.push({
                type: 'event',
                text: `Day ${prev.currentDay} — New ticket: "${newTicket.title}" (${newTicket.storyPoints} SP)`,
                timestamp: Date.now()
              });
              break;
            }
            case 'add_bug_ticket': {
              const newBug = {
                ...action.payload,
                id: `t-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
                status: 'todo' as const,
                assignedTo: null,
                progressPoints: 0,
              };
              updatedTickets.push(newBug);
              newTerminalLines.push({
                type: 'event',
                text: `Day ${prev.currentDay} — BUG reporting: "${newBug.title}" (Penalty: -$${newBug.revenuePenalty}/mo)`,
                timestamp: Date.now()
              });
              break;
            }
            case 'dev_applied': {
              updatedCandidates.push(action.payload);
              newTerminalLines.push({
                type: 'event',
                text: `Day ${prev.currentDay} — Candidate applied: ${action.payload.name} (${action.payload.role}, ${action.payload.level})`,
                timestamp: Date.now()
              });
              break;
            }
            case 'dev_quit': {
              const devId = action.payload.developerId;
              const dev = updatedDevelopers.find(d => d.id === devId);
              if (dev) {
                updatedDevelopers = updatedDevelopers.filter(d => d.id !== devId);
                if (dev.currentTicketId) {
                  updatedTickets = updatedTickets.map(t => 
                    t.id === dev.currentTicketId 
                      ? { ...t, status: 'todo' as const, assignedTo: null } 
                      : t
                  );
                }
                newTerminalLines.push({
                  type: 'event',
                  text: `Day ${prev.currentDay} — Dev resigned: ${dev.name} (${action.payload.reason})`,
                  timestamp: Date.now()
                });
              }
              break;
            }
            case 'market_event': {
              const { headline, revenueEffect, cashEffect, permanent } = action.payload;
              if (permanent) {
                const virtualTicket = {
                  id: `t-market-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
                  title: headline,
                  description: 'Market event effect',
                  type: 'feature' as const,
                  severity: 'medium' as const,
                  storyPoints: 0,
                  revenueIncrease: revenueEffect,
                  revenuePenalty: 0,
                  status: 'done' as const,
                  assignedTo: null,
                  progressPoints: 0,
                };
                updatedTickets.push(virtualTicket);
              }
              updatedCash += cashEffect;
              newTerminalLines.push({
                type: 'event',
                text: `Day ${prev.currentDay} — Market: ${headline} (${cashEffect !== 0 ? `Cash: ${cashEffect >= 0 ? '+' : ''}$${cashEffect.toLocaleString()}` : ''}${revenueEffect !== 0 ? `, MRR: ${revenueEffect >= 0 ? '+' : ''}$${revenueEffect.toLocaleString()}/mo` : ''})`,
                timestamp: Date.now()
              });
              break;
            }
          }
        });

        const nextTurnIndex = prev.loopHistory.length + 1;
        const turn: LoopTurn = {
          turnIndex: nextTurnIndex,
          rawResponse,
          parsedActions,
          timestamp: Date.now(),
        };

        const activePenalties = updatedTickets
          .filter(t => t.type === 'bug' && t.status !== 'done')
          .reduce((sum, t) => sum + t.revenuePenalty, 0);

        const monthlyRevenue = updatedTickets
          .filter(t => t.status === 'done')
          .reduce((sum, t) => sum + t.revenueIncrease, 0);
          
        const monthlyBurnRate = updatedDevelopers.reduce((sum, d) => sum + d.salary, 0);
        const runway = updatedCash / Math.max(monthlyBurnRate - monthlyRevenue + activePenalties, 1);

        return {
          ...prev,
          tickets: updatedTickets,
          developers: updatedDevelopers,
          candidates: updatedCandidates,
          loopHistory: [...prev.loopHistory, turn],
          finances: {
            cash: updatedCash,
            monthlyBurnRate,
            monthlyRevenue,
            activePenalties,
            runway,
          },
          terminalHistory: [...prev.terminalHistory, ...newTerminalLines],
        };
      });
    } catch (error: any) {
      console.error('LLM Loop Error:', error);
      pushLine({ type: 'error', text: `LLM Loop Error: ${error.message}` });
    } finally {
      isLLMLoopRunningRef.current = false;
    }
  }, [pushLine]);

  useEffect(() => {
    if (state.gameStatus !== 'running') return;

    const interval = setInterval(() => {
      triggerLLMLoop();
    }, state.llmConfig.loopIntervalMs);

    return () => clearInterval(interval);
  }, [state.gameStatus, state.llmConfig.loopIntervalMs, triggerLLMLoop]);

  return (
    <div
      className="app-container"
      style={{
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
      }}
    >
      {/* Header */}
      <Header
        companyName={state.companyName}
        currentDay={state.currentDay}
        gameStatus={state.gameStatus}
      />

      {/* Main Content */}
      <main
        className="main-content"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          position: 'relative',
        }}
      >
        {/* Metric Cards Row */}
        <MetricCards finances={state.finances} />

        {/* Team + Events Row */}
        <div className="main-content-row">
          <TeamPanel developers={state.developers} tickets={state.tickets} />
          <RecentEvents terminalHistory={state.terminalHistory} />
        </div>

        {/* Modals */}
        {modal === 'kanban' && (
          <KanbanBoard
            tickets={state.tickets}
            developers={state.developers}
            onClose={() => setModal('none')}
            onMoveTicket={handleMoveTicket}
            onAssignDeveloper={handleAssignDeveloper}
          />
        )}
        {modal === 'hire' && (
          <HireModal
            candidates={state.candidates}
            onClose={() => setModal('none')}
            onHire={handleHire}
          />
        )}
      </main>

      {/* Terminal */}
      <Terminal history={state.terminalHistory} onCommand={handleCommand} />
    </div>
  );
}
