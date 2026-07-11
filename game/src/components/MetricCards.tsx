import { Finances } from '@/lib/types';

interface MetricCardsProps {
  finances: Finances;
}

function fmt(n: number, prefix = '$') {
  return `${prefix}${Math.abs(n).toLocaleString()}`;
}

interface CardProps {
  label: string;
  value: string;
  sub?: string;
  color: string;
  icon: string;
  glowClass: string;
}

function MetricCard({ label, value, sub, color, icon, glowClass }: CardProps) {
  return (
    <div
      className={`${glowClass} metric-card`}
      style={{
        background: '#161922',
        border: `1px solid ${color}30`,
        borderRadius: 10,
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: '#718096', fontSize: 11, letterSpacing: '0.12em' }}>
        <span>{icon}</span>
        <span>{label}</span>
      </div>
      <div style={{ color, fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1 }}>
        {value}
      </div>
      {sub && (
        <div style={{ color: '#4a5568', fontSize: 11 }}>{sub}</div>
      )}
    </div>
  );
}

export default function MetricCards({ finances }: MetricCardsProps) {
  const { cash, monthlyBurnRate, monthlyRevenue, activePenalties, runway } = finances;
  const netFlow = monthlyRevenue - activePenalties - monthlyBurnRate;

  return (
    <div className="metrics-grid">
      <MetricCard
        label="CASH"
        value={fmt(cash)}
        sub={netFlow >= 0 ? `+${fmt(netFlow)} net/mo` : `${fmt(netFlow, '-$')} net/mo`}
        color="#e2e8f0"
        icon="💰"
        glowClass="glow-cyan"
      />
      <MetricCard
        label="MRR"
        value={fmt(monthlyRevenue)}
        sub="monthly recurring"
        color="#00d4ff"
        icon="📈"
        glowClass="glow-cyan"
      />
      <MetricCard
        label="BURN RATE"
        value={`${fmt(monthlyBurnRate)}/mo`}
        sub="salaries + infra"
        color="#ff4466"
        icon="🔥"
        glowClass="glow-red"
      />
      <MetricCard
        label="RUNWAY"
        value={`${runway.toFixed(1)} mo`}
        sub={runway < 6 ? '⚠ Critical' : runway < 12 ? '△ Watch' : '✓ Healthy'}
        color={runway < 6 ? '#ff4466' : runway < 12 ? '#ffaa00' : '#ffaa00'}
        icon="⏱"
        glowClass="glow-amber"
      />
      <MetricCard
        label="ACTIVE PENALTIES"
        value={activePenalties > 0 ? `-${fmt(activePenalties)}/mo` : 'None'}
        sub={activePenalties > 0 ? 'open bugs dragging MRR' : 'no open bugs'}
        color={activePenalties > 0 ? '#ff4466' : '#00ff88'}
        icon="⚠"
        glowClass={activePenalties > 0 ? 'glow-red' : 'glow-green'}
      />
    </div>
  );
}
