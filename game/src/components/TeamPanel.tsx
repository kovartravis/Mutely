import { Developer, DeveloperRole, Ticket } from '@/lib/types';

interface TeamPanelProps {
  developers: Developer[];
  tickets: Ticket[];
}

const roleColors: Record<DeveloperRole, string> = {
  frontend:  '#00d4ff',
  backend:   '#00ff88',
  fullstack: '#a78bfa',
  devops:    '#ffaa00',
  ml:        '#f472b6',
  dba:       '#fb923c',
};

const roleBg: Record<DeveloperRole, string> = {
  frontend:  '#00d4ff18',
  backend:   '#00ff8818',
  fullstack: '#a78bfa18',
  devops:    '#ffaa0018',
  ml:        '#f472b618',
  dba:       '#fb923c18',
};

function MoraleBar({ value }: { value: number }) {
  const color = value >= 70 ? '#00ff88' : value >= 40 ? '#ffaa00' : '#ff4466';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
      <div style={{ flex: 1, height: 4, background: '#1e2433', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${value}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.5s ease' }} />
      </div>
      <span style={{ color: '#718096', fontSize: 11, width: 28, textAlign: 'right' }}>{value}</span>
    </div>
  );
}

export default function TeamPanel({ developers, tickets }: TeamPanelProps) {
  const getTicketTitle = (ticketId: string | null) => {
    if (!ticketId) return null;
    return tickets.find(t => t.id === ticketId)?.title ?? null;
  };

  return (
    <div
      style={{
        background: '#161922',
        border: '1px solid #1e2433',
        borderRadius: 10,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
      }}
    >
      {/* Panel Header */}
      <div style={{ padding: '10px 16px', borderBottom: '1px solid #1e2433', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: '#4a5568', fontSize: 11 }}>👥</span>
        <span style={{ color: '#718096', fontSize: 11, letterSpacing: '0.12em', fontWeight: 600 }}>TEAM</span>
        <span style={{ marginLeft: 'auto', color: '#4a5568', fontSize: 11 }}>{developers.length} devs</span>
      </div>

      {/* Table Header */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '160px 100px 70px 1fr 180px',
          padding: '7px 16px',
          borderBottom: '1px solid #1a1f2e',
          color: '#4a5568',
          fontSize: 10,
          letterSpacing: '0.12em',
        }}
      >
        <span>NAME</span>
        <span>ROLE</span>
        <span>LEVEL</span>
        <span>MORALE</span>
        <span>WORKING ON</span>
      </div>

      {/* Rows */}
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {developers.map((dev) => {
          const working = getTicketTitle(dev.currentTicketId);
          const isActive = !!working;
          const rColor = roleColors[dev.role];
          const rBg    = roleBg[dev.role];

          return (
            <div
              key={dev.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '160px 100px 70px 1fr 180px',
                padding: '9px 16px',
                borderBottom: '1px solid #11141a',
                alignItems: 'center',
                borderLeft: isActive ? `2px solid ${rColor}` : '2px solid transparent',
                background: isActive ? '#ffffff04' : 'transparent',
                transition: 'background 0.2s',
              }}
            >
              {/* Name */}
              <span style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 500 }}>{dev.name}</span>

              {/* Role badge */}
              <span
                style={{
                  background: rBg,
                  border: `1px solid ${rColor}40`,
                  color: rColor,
                  borderRadius: 4,
                  padding: '2px 7px',
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: '0.08em',
                  display: 'inline-block',
                  width: 'fit-content',
                }}
              >
                {dev.role.toUpperCase()}
              </span>

              {/* Level */}
              <span style={{ color: '#718096', fontSize: 11 }}>{dev.level}</span>

              {/* Morale bar */}
              <MoraleBar value={dev.morale} />

              {/* Working on */}
              <span
                style={{
                  color: isActive ? '#00d4ff' : '#4a5568',
                  fontSize: 11,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={working ?? 'idle'}
              >
                {working ?? 'idle'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
