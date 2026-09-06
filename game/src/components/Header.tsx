import { RunState, stageAt, STAGES } from '@/sim';

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

export default function Header({ state }: { state: RunState }) {
  const stage = stageAt(state.stageIndex);
  const progress = Math.max(0, Math.min(1, state.mrr / stage.goalMrr));

  const statusLabel =
    state.status === 'won' ? 'COMPLETE'
    : state.status === 'lost' ? 'INSOLVENT'
    : state.speed === 0 ? 'PAUSED'
    : `RUNNING ${state.speed}x`;

  const statusClass =
    state.status === 'lost' ? 'bloom-bug'
    : state.status === 'won' ? 'bloom-ok'
    : state.speed === 0 ? 'bloom-warn'
    : 'dim';

  return (
    <header
      style={{
        display: 'flex', alignItems: 'center', gap: 16,
        padding: '0 12px', height: 38, flexShrink: 0,
        borderBottom: '1px solid var(--rule)', background: 'var(--bg-panel)',
      }}
    >
      <span style={{ letterSpacing: '0.16em', fontWeight: 600 }}>{state.companyName}</span>

      {/* Stage ladder -- the campaign is always visible, never behind a command. */}
      <div style={{ display: 'flex', gap: 10 }} className="faint">
        {STAGES.map((s, i) => (
          <span
            key={s.key}
            className={i === state.stageIndex ? 'bloom-ok' : undefined}
            style={{ opacity: i < state.stageIndex ? 0.45 : 1, letterSpacing: '0.1em', fontSize: 10 }}
          >
            {i < state.stageIndex ? '✓' : i === state.stageIndex ? '▶' : '·'} {s.name}
          </span>
        ))}
      </div>

      <div style={{ flex: 1, minWidth: 60 }}>
        <div style={{ height: 3, background: 'var(--rule)', position: 'relative' }}>
          <div style={{ position: 'absolute', inset: 0, width: `${progress * 100}%`, background: 'var(--feat)' }} />
        </div>
        <div className="faint nums" style={{ fontSize: 10, marginTop: 2 }}>
          {money(state.mrr)} / {money(stage.goalMrr)} MRR
        </div>
      </div>

      {/* A mode that keeps acting must be visible, or the player loses track of
          why people keep getting assigned. */}
      {state.autoAssign && (
        <span className="bloom-ok" style={{ letterSpacing: '0.1em', fontSize: 11 }}>AUTO</span>
      )}
      <span className="nums dim">DAY {state.day}</span>
      <span className={statusClass} style={{ letterSpacing: '0.1em', fontSize: 11 }}>{statusLabel}</span>
    </header>
  );
}
