import { GameStatus } from '@/lib/types';

interface HeaderProps {
  companyName: string;
  currentDay: number;
  gameStatus: GameStatus;
}

const statusColor: Record<GameStatus, string> = {
  running:   '#00ff88',
  paused:    '#ffaa00',
  game_over: '#ff4466',
};

const statusLabel: Record<GameStatus, string> = {
  running:   '● RUNNING',
  paused:    '⏸ PAUSED',
  game_over: '✕ GAME OVER',
};

export default function Header({ companyName, currentDay, gameStatus }: HeaderProps) {
  const color = statusColor[gameStatus];

  return (
    <header
      className="app-header"
      style={{
        background: '#0d0f14',
        borderBottom: '1px solid #1e2433',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: '44px',
        flexShrink: 0,
        position: 'relative',
        zIndex: 10,
      }}
    >
      {/* Company Name */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ color: '#00d4ff', fontSize: 16, fontWeight: 700, letterSpacing: '0.05em' }}>
          ⬡
        </span>
        <span style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 14, letterSpacing: '0.08em' }}>
          {companyName.toUpperCase()}
        </span>
      </div>

      {/* Day Counter */}
      <div
        style={{
          background: '#1a1f2e',
          border: '1px solid #2d3748',
          borderRadius: 6,
          padding: '3px 14px',
          color: '#e2e8f0',
          fontSize: 13,
          fontWeight: 500,
          letterSpacing: '0.1em',
        }}
      >
        DAY&nbsp;&nbsp;<span style={{ color: '#00d4ff', fontWeight: 700 }}>{currentDay}</span>
      </div>

      {/* Status Pill */}
      <div
        style={{
          background: `${color}14`,
          border: `1px solid ${color}60`,
          borderRadius: 20,
          padding: '3px 14px',
          color: color,
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: '0.1em',
        }}
      >
        {statusLabel[gameStatus]}
      </div>
    </header>
  );
}
