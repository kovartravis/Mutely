import { Ticket, TicketType, TicketSeverity, TicketStatus } from '@/lib/types';

interface KanbanBoardProps {
  tickets: Ticket[];
  onClose: () => void;
  onMoveTicket: (ticketId: string, newStatus: TicketStatus) => void;
}

const columns: { key: TicketStatus; label: string; color: string }[] = [
  { key: 'backlog',     label: 'BACKLOG',     color: '#4a5568' },
  { key: 'todo',        label: 'TO DO',       color: '#718096' },
  { key: 'in_progress', label: 'IN PROGRESS', color: '#00d4ff' },
  { key: 'done',        label: 'DONE',        color: '#00ff88' },
];

const typeColor: Record<TicketType, string> = {
  feature:   '#00d4ff',
  bug:       '#ff4466',
  tech_debt: '#c084fc',
};

const typeLabel: Record<TicketType, string> = {
  feature:   'FEAT',
  bug:       'BUG',
  tech_debt: 'DEBT',
};

const severityColor: Record<TicketSeverity, string> = {
  low:      '#4a5568',
  medium:   '#ffaa00',
  high:     '#ff4466',
  critical: '#ff4466',
};

function TicketCard({ ticket, onMove }: { ticket: Ticket; onMove: (id: string, status: TicketStatus) => void }) {
  const tc = typeColor[ticket.type];
  const canMoveLeft  = ticket.status !== 'backlog';
  const canMoveRight = ticket.status !== 'done';

  const prevStatus: Record<TicketStatus, TicketStatus | null> = {
    backlog: null, todo: 'backlog', in_progress: 'todo', done: 'in_progress',
  };
  const nextStatus: Record<TicketStatus, TicketStatus | null> = {
    backlog: 'todo', todo: 'in_progress', in_progress: 'done', done: null,
  };

  return (
    <div
      style={{
        background: '#0d0f14',
        border: `1px solid ${tc}30`,
        borderLeft: `3px solid ${tc}`,
        borderRadius: 6,
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      {/* Type + Severity */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <span style={{ background: `${tc}20`, color: tc, fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 3, letterSpacing: '0.1em' }}>
          {typeLabel[ticket.type]}
        </span>
        <span style={{ color: severityColor[ticket.severity], fontSize: 9, letterSpacing: '0.1em' }}>
          {ticket.severity.toUpperCase()}
        </span>
        <span style={{ marginLeft: 'auto', color: '#4a5568', fontSize: 10 }}>{ticket.storyPoints}sp</span>
      </div>

      {/* Title */}
      <div style={{ color: '#e2e8f0', fontSize: 12, fontWeight: 500, lineHeight: 1.4 }}>{ticket.title}</div>

      {/* Revenue */}
      {ticket.revenueIncrease > 0 && (
        <div style={{ color: '#00ff8880', fontSize: 10 }}>+${ticket.revenueIncrease.toLocaleString()}/mo on done</div>
      )}
      {ticket.revenuePenalty > 0 && (
        <div style={{ color: '#ff446680', fontSize: 10 }}>-${ticket.revenuePenalty.toLocaleString()}/mo while open</div>
      )}

      {/* Progress */}
      {ticket.status === 'in_progress' && (
        <div style={{ height: 3, background: '#1e2433', borderRadius: 2, overflow: 'hidden' }}>
          <div
            style={{
              width: `${(ticket.progressPoints / ticket.storyPoints) * 100}%`,
              height: '100%',
              background: tc,
              borderRadius: 2,
            }}
          />
        </div>
      )}

      {/* Move buttons */}
      <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
        {canMoveLeft && (
          <button
            id={`ticket-${ticket.id}-move-left`}
            onClick={() => onMove(ticket.id, prevStatus[ticket.status]!)}
            style={{
              background: '#1a1f2e', border: '1px solid #2d3748', color: '#718096',
              borderRadius: 4, padding: '3px 8px', fontSize: 10, cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            ← Back
          </button>
        )}
        {canMoveRight && (
          <button
            id={`ticket-${ticket.id}-move-right`}
            onClick={() => onMove(ticket.id, nextStatus[ticket.status]!)}
            style={{
              background: `${tc}18`, border: `1px solid ${tc}40`, color: tc,
              borderRadius: 4, padding: '3px 8px', fontSize: 10, cursor: 'pointer', fontFamily: 'inherit',
              marginLeft: 'auto',
            }}
          >
            Move → 
          </button>
        )}
      </div>
    </div>
  );
}

export default function KanbanBoard({ tickets, onClose, onMoveTicket }: KanbanBoardProps) {
  return (
    <div
      style={{
        position: 'absolute', inset: 0, zIndex: 50,
        background: '#0d0f14e8',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Modal Header */}
      <div
        style={{
          display: 'flex', alignItems: 'center', padding: '14px 24px',
          borderBottom: '1px solid #1e2433', gap: 12,
        }}
      >
        <span style={{ color: '#00d4ff', fontSize: 14, letterSpacing: '0.1em', fontWeight: 700 }}>
          ▦ KANBAN BOARD
        </span>
        <span style={{ color: '#4a5568', fontSize: 12 }}>— {tickets.filter(t => t.status !== 'done').length} open tickets</span>
        <button
          id="kanban-close"
          onClick={onClose}
          style={{
            marginLeft: 'auto', background: '#1a1f2e', border: '1px solid #2d3748',
            color: '#718096', borderRadius: 6, padding: '4px 14px',
            fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '0.05em',
          }}
        >
          ESC — Close
        </button>
      </div>

      {/* Columns */}
      <div style={{ display: 'flex', gap: 0, flex: 1, overflow: 'hidden' }}>
        {columns.map((col, ci) => {
          const colTickets = tickets.filter(t => t.status === col.key);
          return (
            <div
              key={col.key}
              style={{
                flex: 1,
                borderRight: ci < columns.length - 1 ? '1px solid #1e2433' : 'none',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
              }}
            >
              {/* Column Header */}
              <div
                style={{
                  padding: '10px 16px', borderBottom: '1px solid #1e2433',
                  display: 'flex', alignItems: 'center', gap: 8,
                }}
              >
                <span style={{ color: col.color, fontSize: 11, fontWeight: 700, letterSpacing: '0.12em' }}>
                  {col.label}
                </span>
                <span
                  style={{
                    background: `${col.color}20`, color: col.color,
                    borderRadius: 10, padding: '1px 8px', fontSize: 10, fontWeight: 700,
                  }}
                >
                  {colTickets.length}
                </span>
              </div>

              {/* Cards */}
              <div style={{ overflowY: 'auto', flex: 1, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {colTickets.map(ticket => (
                  <TicketCard key={ticket.id} ticket={ticket} onMove={onMoveTicket} />
                ))}
                {colTickets.length === 0 && (
                  <div style={{ color: '#2d3748', fontSize: 11, textAlign: 'center', marginTop: 20 }}>
                    Empty
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
