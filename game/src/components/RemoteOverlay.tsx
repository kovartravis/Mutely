import { coordinationDrag, REMOTE_COUNTRIES, RunState } from '@/sim';

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 10, whiteSpace: 'pre' }}>
      <span className="faint" style={{ minWidth: 84 }}>{label}</span>
      <span>{children}</span>
    </div>
  );
}

export default function RemoteOverlay({ state }: { state: RunState }) {
  const wp = state.workplace;
  const drag = coordinationDrag(state);
  const unlocked = wp.unlockedCountries;
  const locked = Object.keys(REMOTE_COUNTRIES).filter((k) => !unlocked.includes(k));

  return (
    <div className="panel" style={{ flex: 1, margin: '0 8px', overflow: 'hidden' }}>
      <div className="panel-title">
        <span>REMOTE -- {unlocked.length} COUNTR{unlocked.length === 1 ? 'Y' : 'IES'} UNLOCKED</span>
        <span className="faint">/remote or Esc to close</span>
      </div>
      <div className="panel-body" style={{ overflowY: 'auto' }}>
        <div className="rows">
          <Row label="coord. drag">
            <span className={drag < 1 ? 'bloom-warn' : ''}>{drag.toFixed(2)}x velocity</span>
            <span className="faint">  spreading hiring across more countries costs throughput</span>
          </Row>
        </div>

        {wp.pending && (
          <div className="bloom-warn" style={{ marginTop: 10 }}>
            Switching Work Mode -- {wp.pending.daysLeft} days left, reduced velocity.
          </div>
        )}

        <div className="faint" style={{ marginTop: 14, fontSize: 10, letterSpacing: '0.16em' }}>UNLOCKED</div>
        <div className="rows" style={{ marginTop: 4 }}>
          {unlocked.map((key) => {
            const c = REMOTE_COUNTRIES[key];
            const here = state.developers.filter((d) => d.country === key).length;
            return (
              <Row key={key} label={`▶ ${c.label}`}>
                <span>{here} hired · salary x{c.salaryMultiplier.toFixed(2)} · pool +{c.poolBonus} -- {c.description}</span>
              </Row>
            );
          })}
        </div>

        {locked.length > 0 && (
          <>
            <div className="faint" style={{ marginTop: 14, fontSize: 10, letterSpacing: '0.16em' }}>LOCKED</div>
            <div className="rows" style={{ marginTop: 4 }}>
              {locked.map((key) => {
                const c = REMOTE_COUNTRIES[key];
                return (
                  <Row key={key} label={`  ${c.label}`}>
                    <span className="dim">
                      unlock {money(c.unlockCost)} · salary x{c.salaryMultiplier.toFixed(2)} · pool +{c.poolBonus} -- {c.description}
                    </span>
                    <span className="faint">  /remote unlock {key}</span>
                  </Row>
                );
              })}
            </div>
          </>
        )}

        <div className="faint" style={{ marginTop: 14 }}>
          Unlocking a country is additive and instant. Switching to In-person costs cash, days of reduced
          velocity, and some staff won&apos;t make the move -- /workmode inperson.
        </div>
      </div>
    </div>
  );
}
