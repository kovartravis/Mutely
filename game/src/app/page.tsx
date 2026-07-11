'use client';

import { useState, useCallback } from 'react';
import { MOCK_GAME_STATE } from '@/lib/mockData';
import { GameState, TicketStatus, TerminalLine } from '@/lib/types';
import Header from '@/components/Header';
import MetricCards from '@/components/MetricCards';
import TeamPanel from '@/components/TeamPanel';
import RecentEvents from '@/components/RecentEvents';
import Terminal from '@/components/Terminal';
import KanbanBoard from '@/components/KanbanBoard';
import HireModal from '@/components/HireModal';

type Modal = 'none' | 'kanban' | 'hire';

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
        pushLine({ type: 'output', text: '  /settings             - View current LLM simulator configurations' });
        pushLine({ type: 'output', text: '  /settings <key> <val> - Change configurations (keys: endpoint, apiKey, model, interval, turns)' });
        pushLine({ type: 'output', text: '  /help                 - Display this commands directory' });
        break;

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
            onClose={() => setModal('none')}
            onMoveTicket={handleMoveTicket}
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
