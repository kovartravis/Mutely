import {
  ARCHITECTURES, Architecture, cacheCost, computeCost, DB_ENGINE_SPECS,
  DB_ENGINES, dbCost, debtInflation, effectiveCapacity, INFRA, RunState,
  RUNTIME_SPECS, RUNTIMES, utilization,
} from '@/sim';

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
const RESOURCE_LABEL: Record<Architecture, string> = {
  monolith: 'tier', kubernetes: 'node', serverless: 'concurrency unit',
};
const ARCH_BLURB: Record<Architecture, string> = {
  monolith: 'cheap and simple, cost grows superlinearly with scale',
  kubernetes: 'fixed cluster overhead, then cheap linear scaling',
  serverless: 'pay per request, no idle waste, pricier at real scale',
};

/** One line of the flow diagram: a label, a value, and an optional note. */
function DiagramRow({ arrow, label, value, tone, note }: {
  arrow: boolean; label: string; value: string; tone?: string; note?: string;
}) {
  return (
    <div style={{ whiteSpace: 'pre' }}>
      {arrow && <div className="faint">   │</div>}
      {arrow && <div className="faint">   ▼</div>}
      <div>
        <span className={tone ?? 'faint'} style={{ minWidth: 90, display: 'inline-block' }}>{label}</span>
        <span className="nums">{value}</span>
        {note && <span className="faint">  {note}</span>}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 10, whiteSpace: 'pre' }}>
      <span className="faint" style={{ minWidth: 84 }}>{label}</span>
      <span>{children}</span>
    </div>
  );
}

export default function ArchitectureOverlay({ state }: { state: RunState }) {
  const infra = state.infra;
  const u = utilization(state);
  const debt = debtInflation(state);
  const cache = infra.cache;
  const cCost = computeCost(infra);
  const dCost = dbCost(infra);
  const cacheC = cacheCost(infra);
  const overTone = u > 1 ? 'bloom-bug' : u > 0.85 ? 'bloom-warn' : 'faint';

  return (
    <div className="panel" style={{ flex: 1, margin: '0 8px', overflow: 'hidden' }}>
      <div className="panel-title">
        <span>ARCHITECTURE DIAGRAM</span>
        <span className="faint">/architecture or Esc to close</span>
      </div>
      <div className="panel-body" style={{ overflowY: 'auto' }}>
        {/* ── Flow diagram ──────────────────────────────────────────────── */}
        <DiagramRow arrow={false} label="TRAFFIC" value={`${Math.round(infra.traffic).toLocaleString()} req/day`} />
        {cache.active && (
          <DiagramRow
            arrow
            label="CACHE"
            value={`${(cache.hitRate * 100).toFixed(0)}% hit`}
            note={`tier ${cache.tier} · ${money(cacheC)}/mo`}
          />
        )}
        <DiagramRow
          arrow
          label="COMPUTE"
          tone={overTone}
          value={`${infra.architecture} · ${infra.compute} ${RESOURCE_LABEL[infra.architecture]}${infra.compute === 1 ? '' : 's'}`}
          note={`${RUNTIME_SPECS[infra.runtime].label} · ${money(cCost)}/mo`}
        />
        <DiagramRow
          arrow
          label="DATABASE"
          tone={overTone}
          value={`${DB_ENGINE_SPECS[infra.dbEngine].label} · ${infra.dbReplicas} replica${infra.dbReplicas === 1 ? '' : 's'}`}
          note={`${money(dCost)}/mo`}
        />

        <div className="rows" style={{ marginTop: 12 }}>
          <Row label="capacity">
            <span className={overTone}>{Math.round(effectiveCapacity(state)).toLocaleString()} req/day</span>
            {' '}({(u * 100).toFixed(0)}% utilized{u > 1 ? ' -- OVER CAPACITY' : ''})
          </Row>
          {debt > 1 && <Row label="debt load">x{debt.toFixed(2)} (open tech debt inflates required capacity)</Row>}
          <Row label="total cost"><span className="nums">{money(cCost + dCost + cacheC)}/mo</span></Row>
        </div>

        {infra.pending && (
          <div className="bloom-warn" style={{ marginTop: 10 }}>
            {infra.pending.kind === 'architecture' ? 'Migrating' : 'Switching'} to {String(infra.pending.target).toUpperCase()}
            {' '}-- {infra.pending.daysLeft} days left, reduced velocity.
          </div>
        )}

        {/* ── Main architecture options ────────────────────────────────── */}
        <div className="faint" style={{ marginTop: 14, fontSize: 10, letterSpacing: '0.16em' }}>MAIN ARCHITECTURE</div>
        <div className="rows" style={{ marginTop: 4 }}>
          {ARCHITECTURES.map((a) => (
            <Row key={a} label={a === infra.architecture ? `▶ ${a}` : `  ${a}`}>
              <span className={a === infra.architecture ? '' : 'dim'}>{ARCH_BLURB[a]}</span>
              {a !== infra.architecture && <span className="faint">  /migrate {a}</span>}
            </Row>
          ))}
        </div>

        {/* ── Database sub-architecture ────────────────────────────────── */}
        <div className="faint" style={{ marginTop: 14, fontSize: 10, letterSpacing: '0.16em' }}>DATABASE ENGINE</div>
        <div className="rows" style={{ marginTop: 4 }}>
          {DB_ENGINES.map((e) => {
            const spec = DB_ENGINE_SPECS[e];
            const available = spec.availableOn.includes(infra.architecture);
            const current = e === infra.dbEngine;
            return (
              <Row key={e} label={current ? `▶ ${spec.label}` : `  ${spec.label}`}>
                <span className={current ? '' : available ? 'dim' : 'faint'}>
                  sp {spec.spDelta >= 0 ? '+' : ''}{spec.spDelta} · capacity x{spec.capacityMultiplier} · cost x{spec.costMultiplier} -- {spec.description}
                </span>
                {!current && (available
                  ? <span className="faint">  /switch db {e}</span>
                  : <span className="faint bloom-bug"> not on {infra.architecture}</span>)}
              </Row>
            );
          })}
        </div>

        {/* ── Compute runtime sub-architecture ─────────────────────────── */}
        <div className="faint" style={{ marginTop: 14, fontSize: 10, letterSpacing: '0.16em' }}>COMPUTE RUNTIME</div>
        <div className="rows" style={{ marginTop: 4 }}>
          {RUNTIMES.map((r) => {
            const spec = RUNTIME_SPECS[r];
            const current = r === infra.runtime;
            return (
              <Row key={r} label={current ? `▶ ${spec.label}` : `  ${spec.label}`}>
                <span className={current ? '' : 'dim'}>
                  sp {spec.spDelta >= 0 ? '+' : ''}{spec.spDelta} · capacity x{spec.capacityMultiplier} · cost x{spec.costMultiplier} -- {spec.description}
                </span>
                {!current && <span className="faint">  /switch runtime {r}</span>}
              </Row>
            );
          })}
        </div>

        {/* ── Cache ─────────────────────────────────────────────────────── */}
        <div className="faint" style={{ marginTop: 14, fontSize: 10, letterSpacing: '0.16em' }}>CACHE</div>
        <div className="rows" style={{ marginTop: 4 }}>
          {cache.active ? (
            <>
              <Row label="status">tier {cache.tier} of {INFRA.cache.tiers.length - 1} · {(cache.hitRate * 100).toFixed(0)}% hit rate · {money(cacheC)}/mo</Row>
              <Row label="staleness">
                refreshed {state.day - cache.lastRefreshedDay}d ago -- decays past {INFRA.cache.staleAfterDays}d,
                integrity risk below {(INFRA.cache.tiers[cache.tier].maxHitRate * INFRA.cache.integrityRiskFraction * 100).toFixed(0)}% hit rate
              </Row>
              {cache.tier < INFRA.cache.tiers.length - 1 && (
                <Row label="upgrade">
                  <span className="faint">
                    /cache upgrade -- tier {cache.tier + 1}, up to {(INFRA.cache.tiers[cache.tier + 1].maxHitRate * 100).toFixed(0)}% hit, {money(INFRA.cache.tiers[cache.tier + 1].monthlyCost)}/mo
                  </span>
                </Row>
              )}
              <Row label="refresh"><span className="faint">/cache refresh -- resets the staleness clock</span></Row>
            </>
          ) : (
            <Row label="status">
              not active -- <span className="faint">/cache buy</span> for tier 1, up to {(INFRA.cache.tiers[1].maxHitRate * 100).toFixed(0)}% hit rate, {money(INFRA.cache.tiers[1].monthlyCost)}/mo
            </Row>
          )}
        </div>

        <div className="faint" style={{ marginTop: 14 }}>
          Switching Architecture costs cash and slows the team for days -- a real bet, not a free re-roll.
        </div>
      </div>
    </div>
  );
}
