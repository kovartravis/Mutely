import {
  cacheCost, computeCost, computeEfficiency, DB_ENGINE_SPECS, dbCost, dbEfficiency, debtInflation,
  effectiveCapacity, RunState, RUNTIME_SPECS, utilization,
} from '@/sim';
import Meter from './Meter';

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
const RESOURCE_LABEL: Record<string, string> = {
  monolith: 'tier', kubernetes: 'node', serverless: 'concurrency unit',
};

export default function ArchitecturePanel({ state }: { state: RunState }) {
  const infra = state.infra;
  const u = utilization(state);
  const debt = debtInflation(state);
  const capacity = effectiveCapacity(state);
  const label = RESOURCE_LABEL[infra.architecture];
  const overTone = u > 1 ? 'var(--bug)' : u > 0.85 ? 'var(--warn)' : 'var(--feat)';
  const cache = infra.cache;

  return (
    <div className="panel" style={{ flex: 1 }}>
      <div className="panel-title">
        <span>ARCHITECTURE · {infra.architecture.toUpperCase()}</span>
        <span className={u > 1 ? 'bloom-bug' : 'faint'}>{(u * 100).toFixed(0)}% util</span>
      </div>
      <div className="panel-body">
        <div className="rows">
          {infra.pending && (
            <div className="bloom-warn">
              {infra.pending.kind === 'architecture' ? 'migrating' : 'switching'} -&gt; {String(infra.pending.target).toUpperCase()}
              {' '}({infra.pending.daysLeft}d left)
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, whiteSpace: 'pre' }}>
            <span className="faint" style={{ minWidth: 70 }}>traffic</span>
            <span className="nums">{Math.round(infra.traffic).toLocaleString()} req/day</span>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', whiteSpace: 'pre' }}>
            <span className="faint" style={{ minWidth: 70 }}>capacity</span>
            <Meter value={Math.min(u, 1.5)} max={1.5} width={10} tone={overTone} />
            <span className="nums" style={{ color: overTone }}>
              {Math.round(capacity).toLocaleString()} req/day
            </span>
          </div>

          {debt > 1 && (
            <div className="dim" style={{ paddingLeft: 78 }}>
              debt inflates need {debt.toFixed(2)}x
            </div>
          )}

          <div style={{ marginTop: 6, display: 'flex', gap: 8, whiteSpace: 'pre' }}>
            <span className="faint" style={{ minWidth: 70 }}>compute</span>
            <span className="nums">
              {infra.compute} {label}{infra.compute === 1 ? '' : 's'}
            </span>
            <span className="dim">{RUNTIME_SPECS[infra.runtime].label}</span>
            <span className="dim nums">{money(computeCost(infra))}/mo</span>
            <span className="faint">devops {computeEfficiency(state).toFixed(2)}x</span>
          </div>

          <div style={{ display: 'flex', gap: 8, whiteSpace: 'pre' }}>
            <span className="faint" style={{ minWidth: 70 }}>database</span>
            <span className="nums">
              {infra.dbReplicas} replica{infra.dbReplicas === 1 ? '' : 's'}
            </span>
            <span className="dim">{DB_ENGINE_SPECS[infra.dbEngine].label}</span>
            <span className="dim nums">{money(dbCost(infra))}/mo</span>
            <span className="faint">dba {dbEfficiency(state).toFixed(2)}x</span>
          </div>

          {cache.active && (
            <div style={{ display: 'flex', gap: 8, whiteSpace: 'pre' }}>
              <span className="faint" style={{ minWidth: 70 }}>cache</span>
              <span className="nums">tier {cache.tier}, {(cache.hitRate * 100).toFixed(0)}% hit</span>
              <span className="dim nums">{money(cacheCost(infra))}/mo</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
