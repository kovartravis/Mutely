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
        pushLine({ type: 'output', text: 'Commands: /hire  /backlog  /pause  /resume  /settings  /help' });
        break;

      case '/settings':
        pushLine({ type: 'output', text: 'Settings coming soon. Edit llmConfig in game state.' });
        break;

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
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        overflow: 'hidden',
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
        style={{
          flex: 1,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          padding: '14px 18px',
          gap: 12,
          position: 'relative',
        }}
      >
        {/* Metric Cards Row */}
        <MetricCards finances={state.finances} />

        {/* Team + Events Row */}
        <div style={{ display: 'flex', gap: 12, flex: 1, overflow: 'hidden', minHeight: 0 }}>
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
