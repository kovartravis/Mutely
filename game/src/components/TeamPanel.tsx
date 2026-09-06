import { daysRemaining, RunState, topDiscipline, velocityMultiplier } from '@/sim';
import Meter from './Meter';

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

export default function TeamPanel({ state }: { state: RunState }) {
  const dragNow = velocityMultiplier(state);
  const burn = state.developers.reduce((sum, d) => sum + d.salary, 0);

  return (
    <div className="panel" style={{ flex: 1 }}>
      <div className="panel-title">
        <span>TEAM · {state.developers.length}</span>
        <span className="faint nums">{money(burn)}/mo</span>
      </div>
      <div className="panel-body">
        {state.developers.length === 0 ? (
          <div className="bloom-warn">No developers. Nothing ships. /hire</div>
        ) : (
          <div className="rows">
            {state.developers.map((dev) => {
              const ticket = dev.currentTicketId
                ? state.tickets.find((t) => t.id === dev.currentTicketId)
                : null;
              const top = topDiscipline(dev.proficiency);
              const eta = ticket ? daysRemaining(dev, ticket, dragNow) : null;
              const moraleColor =
                dev.morale < 30 ? 'var(--bug)' : dev.morale < 50 ? 'var(--warn)' : 'var(--ink-dim)';

              return (
                <div key={dev.id} style={{ display: 'flex', gap: 8, whiteSpace: 'pre' }}>
                  <span style={{ minWidth: 76 }}>@{dev.handle}</span>
                  <span className="faint" style={{ minWidth: 46 }}>{dev.level}</span>
                  <span className="dim" style={{ minWidth: 96 }}>
                    {top.slice(0, 8).padEnd(8)} {Math.round(dev.proficiency[top]).toString().padStart(3)}
                  </span>
                  <span className="nums" style={{ minWidth: 74, color: moraleColor }}>
                    <Meter value={dev.morale} tone={moraleColor} />{' '}
                    {Math.round(dev.morale).toString().padStart(3)}
                  </span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {dev.noticeDaysLeft !== null ? (
                      <span className="bloom-bug">NOTICE · leaves in {dev.noticeDaysLeft}d</span>
                    ) : ticket ? (
                      <span className="dim">
                        #{ticket.handle} {eta === null ? 'stalled' : `~${eta}d`}
                        <span className="faint"> {ticket.title}</span>
                      </span>
                    ) : (
                      <span className="faint">idle</span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {state.candidates.length > 0 && (
          <>
            <div className="faint" style={{ marginTop: 10, fontSize: 10, letterSpacing: '0.16em' }}>
              CANDIDATES
            </div>
            <div className="rows" style={{ marginTop: 4 }}>
              {state.candidates.map((c) => {
                const top = topDiscipline(c.proficiency);
                return (
                  <div key={c.id} className="dim" style={{ display: 'flex', gap: 8, whiteSpace: 'pre' }}>
                    <span style={{ minWidth: 76 }}>@{c.handle}</span>
                    <span className="faint" style={{ minWidth: 46 }}>{c.level}</span>
                    <span style={{ minWidth: 96 }}>
                      {top.slice(0, 8).padEnd(8)} {c.proficiency[top].toString().padStart(3)}
                    </span>
                    <span className="nums" style={{ minWidth: 74 }}>{money(c.salary)}/mo</span>
                    <span className="faint">{c.expiresDay - state.day}d left</span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
