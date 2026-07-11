import { TerminalLine } from '@/lib/types';

interface RecentEventsProps {
  terminalHistory: TerminalLine[];
}

function eventColor(type: TerminalLine['type'], text: string): string {
  if (type === 'error') return '#ff4466';
  if (type === 'input') return '#718096';
  if (type === 'event') {
    if (text.toLowerCase().includes('bug')) return '#ff4466';
    if (text.toLowerCase().includes('market') || text.toLowerCase().includes('vc')) return '#ffaa00';
    if (text.toLowerCase().includes('tech_debt') || text.toLowerCase().includes('tech debt')) return '#c084fc';
    if (text.toLowerCase().includes('quit') || text.toLowerCase().includes('left')) return '#ff4466';
    if (text.toLowerCase().includes('hired') || text.toLowerCase().includes('applied')) return '#00ff88';
    return '#00d4ff'; // default event = feature
  }
  return '#4a5568';
}

function eventIcon(text: string): string {
  if (text.toLowerCase().includes('bug')) return '🐛';
  if (text.toLowerCase().includes('market') || text.toLowerCase().includes('vc')) return '📊';
  if (text.toLowerCase().includes('tech debt')) return '🔧';
  if (text.toLowerCase().includes('quit')) return '🚪';
  if (text.toLowerCase().includes('applied') || text.toLowerCase().includes('hired')) return '👤';
  return '✦';
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return `${Math.floor(diff / 3600000)}h ago`;
}

export default function RecentEvents({ terminalHistory }: RecentEventsProps) {
  const events = [...terminalHistory].reverse().slice(0, 20);

  return (
    <div
      style={{
        background: '#161922',
        border: '1px solid #1e2433',
        borderRadius: 10,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        width: '38%',
        flexShrink: 0,
      }}
    >
      {/* Panel Header */}
      <div style={{ padding: '10px 16px', borderBottom: '1px solid #1e2433', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: '#4a5568', fontSize: 11 }}>⚡</span>
        <span style={{ color: '#718096', fontSize: 11, letterSpacing: '0.12em', fontWeight: 600 }}>RECENT EVENTS</span>
      </div>

      {/* Events List */}
      <div style={{ overflowY: 'auto', flex: 1, padding: '8px 0' }}>
        {events.length === 0 && (
          <div style={{ padding: '20px 16px', color: '#4a5568', fontSize: 12, textAlign: 'center' }}>
            No events yet...
          </div>
        )}
        {events.map((line, i) => {
          if (line.type === 'input') return null;
          const color = eventColor(line.type, line.text);
          const icon  = eventIcon(line.text);
          return (
            <div
              key={i}
              style={{
                padding: '7px 16px',
                display: 'flex',
                gap: 10,
                alignItems: 'flex-start',
                borderBottom: '1px solid #11141a',
              }}
            >
              <span style={{ color, fontSize: 12, flexShrink: 0, marginTop: 1 }}>{icon}</span>
              <span style={{ color, fontSize: 12, flex: 1, lineHeight: 1.5 }}>{line.text}</span>
              <span style={{ color: '#2d3748', fontSize: 10, flexShrink: 0, marginTop: 2 }}>{timeAgo(line.timestamp)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
