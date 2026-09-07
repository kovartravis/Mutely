import { effectiveSeverity, isOpen, RunState, Ticket } from '@/sim';
import Meter from './Meter';

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

/* Routine types stay desaturated; only bugs are allowed the alarm colour. */
const TYPE_STYLE: Record<Ticket['type'], { label: string; className?: string; color?: string }> = {
  feature:   { label: 'FEAT', color: 'var(--feat)' },
  tech_debt: { label: 'DEBT', color: 'var(--debt)' },
  bug:       { label: 'BUG ', className: 'bloom-bug' },
};

export default function BoardPanel({ state }: { state: RunState }) {
  const open = [...state.tickets].filter(isOpen).sort((a, b) => {
    const rank = (t: Ticket) => (t.type === 'bug' ? 0 : t.type === 'feature' ? 1 : 2);
    return rank(a) - rank(b) || b.createdDay - a.createdDay;
  });

  const wip = open.filter((t) => t.status === 'in_progress').length;

  return (
    <div className="panel" style={{ flex: 1 }}>
      <div className="panel-title">
        <span>BOARD · {open.length} OPEN</span>
        <span className="faint">{wip} in progress</span>
      </div>
      <div className="panel-body">
        {open.length === 0 ? (
          <div className="faint">Backlog clear.</div>
        ) : (
          <div className="rows">
            {open.map((t) => {
              const style = TYPE_STYLE[t.type];
              const assigned = t.assignedTo
                ? state.developers.find((d) => d.id === t.assignedTo)
                : null;
              const severity = effectiveSeverity(t);
              return (
                <div key={t.id} style={{ display: 'flex', gap: 8, whiteSpace: 'pre' }}>
                  <span className="faint" style={{ minWidth: 34 }}>#{t.handle}</span>
                  <span className={style.className} style={{ color: style.color, minWidth: 34 }}>
                    {style.label}
                  </span>
                  <span
                    className={severity === 'critical' ? 'bloom-bug' : 'faint'}
                    style={{ minWidth: 46 }}
                  >
                    {severity}
                  </span>
                  <span className="bloom-warn" style={{ minWidth: 16 }}>
                    {t.escalationLevel > 0 ? `^${t.escalationLevel}` : ''}
                  </span>
                  <span className="faint" style={{ minWidth: 58 }}>{t.discipline}</span>
                  <span className="faint nums" style={{ minWidth: 30 }}>{t.storyPoints}sp</span>
                  <span className="nums" style={{ minWidth: 52 }}>
                    {t.progressPoints > 0 && (
                      <Meter value={t.progressPoints} max={t.storyPoints} width={6} tone="var(--feat)" />
                    )}
                  </span>
                  <span className="dim" style={{ minWidth: 66 }}>
                    {assigned ? `@${assigned.handle}` : ''}
                  </span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {t.title}
                    {t.type === 'feature' && (
                      <span className="faint"> +{money(t.revenue)}/mo</span>
                    )}
                    {t.type === 'feature' && t.expiresDay !== null && (
                      <span className="faint">  exp {Math.max(0, t.expiresDay - state.day)}d</span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
