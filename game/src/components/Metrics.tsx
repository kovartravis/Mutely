import { Finances, RunState, stageAt, utilization } from '@/sim';

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

function Tile({ label, value, sub, tone }: {
  label: string; value: string; sub: string; tone?: 'bug' | 'warn' | 'ok';
}) {
  return (
    <div className="panel" style={{ padding: '8px 10px', gap: 3 }}>
      <div className="faint" style={{ fontSize: 10, letterSpacing: '0.16em' }}>{label}</div>
      <div
        className={tone ? `bloom-${tone} nums` : 'nums'}
        style={{ fontSize: 19, lineHeight: 1.1, letterSpacing: '-0.01em' }}
      >
        {value}
      </div>
      <div className="faint" style={{ fontSize: 10 }}>{sub}</div>
    </div>
  );
}

export default function Metrics({ state, finances }: { state: RunState; finances: Finances }) {
  const { cash, mrr, burn, churnRate, drag, runway } = finances;
  const net = mrr - burn;
  const stage = stageAt(state.stageIndex);

  const churnMultiple = churnRate / stage.baseChurn;
  const openBugs = state.tickets.filter((t) => t.type === 'bug' && t.status !== 'done').length;
  const openDebt = state.tickets.filter((t) => t.type === 'tech_debt' && t.status !== 'done').length;
  const u = utilization(state);

  return (
    <div className="metrics">
      <Tile
        label="CASH"
        value={money(cash)}
        sub={`${net >= 0 ? '+' : '−'}${money(Math.abs(net))} net/mo`}
        tone={cash < burn ? 'bug' : undefined}
      />
      <Tile
        label="RUNWAY"
        value={runway === Infinity ? '∞' : `${runway.toFixed(1)} mo`}
        sub={runway === Infinity ? 'cash-flow positive' : runway < 3 ? 'critical' : runway < 8 ? 'thin' : 'healthy'}
        tone={runway < 3 ? 'bug' : runway < 8 ? 'warn' : undefined}
      />
      <Tile label="MRR" value={money(mrr)} sub={`burn ${money(burn)}/mo`} />
      <Tile
        label="CHURN"
        value={`${(churnRate * 100).toFixed(1)}%`}
        sub={openBugs === 0 ? 'no open bugs' : `${churnMultiple.toFixed(1)}× base · ${openBugs} bug${openBugs === 1 ? '' : 's'}`}
        tone={churnMultiple >= 2 ? 'bug' : churnMultiple >= 1.4 ? 'warn' : undefined}
      />
      <Tile
        label="DRAG"
        value={`${drag.toFixed(2)}×`}
        sub={openDebt === 0 ? 'no open debt' : `${openDebt} debt ticket${openDebt === 1 ? '' : 's'}`}
        tone={drag < 0.7 ? 'bug' : drag < 0.88 ? 'warn' : undefined}
      />
      <Tile
        label="INFRA"
        value={`${(u * 100).toFixed(0)}%`}
        sub={u > 1 ? 'over capacity' : `${state.infra.architecture}`}
        tone={u > 1 ? 'bug' : u > 0.85 ? 'warn' : undefined}
      />
    </div>
  );
}
