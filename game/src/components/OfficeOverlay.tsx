import { OFFICE_CITIES, officeCost, RunState, WORKPLACE } from '@/sim';

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 10, whiteSpace: 'pre' }}>
      <span className="faint" style={{ minWidth: 84 }}>{label}</span>
      <span>{children}</span>
    </div>
  );
}

export default function OfficeOverlay({ state }: { state: RunState }) {
  const wp = state.workplace;
  const cityKey = wp.officeCity!;
  const city = OFFICE_CITIES[cityKey];
  const rent = officeCost(wp);
  const full = state.developers.length >= wp.officeSize;

  return (
    <div className="panel" style={{ flex: 1, margin: '0 8px', overflow: 'hidden' }}>
      <div className="panel-title">
        <span>OFFICE -- {city.label.toUpperCase()}</span>
        <span className="faint">/office or Esc to close</span>
      </div>
      <div className="panel-body" style={{ overflowY: 'auto' }}>
        <div className="rows">
          <Row label="headcount">
            <span className={full ? 'bloom-warn' : ''}>{state.developers.length} / {wp.officeSize} seats</span>
            {full && <span className="faint">  full -- /office expand to hire more</span>}
          </Row>
          <Row label="rent"><span className="nums">{money(rent)}/mo</span></Row>
          <Row label="salary">x{city.salaryMultiplier.toFixed(2)} local expectation</Row>
          <Row label="pool">+{city.poolBonus} candidates from being local</Row>
        </div>

        {wp.pending && (
          <div className="bloom-warn" style={{ marginTop: 10 }}>
            {wp.pending.kind === 'relocate' ? 'Relocating' : 'Switching Work Mode'} --{' '}
            {wp.pending.daysLeft} days left, reduced velocity.
          </div>
        )}

        <div className="faint" style={{ marginTop: 14, fontSize: 10, letterSpacing: '0.16em' }}>EXPAND</div>
        <div className="rows" style={{ marginTop: 4 }}>
          <Row label="  +seats">
            <span className="dim">
              +{WORKPLACE.officeExpandSeats} seats for {money(WORKPLACE.officeExpandSeats * WORKPLACE.officeExpandCostPerSeat)}
            </span>
            <span className="faint">  /office expand</span>
          </Row>
        </div>

        <div className="faint" style={{ marginTop: 14, fontSize: 10, letterSpacing: '0.16em' }}>CITIES</div>
        <div className="rows" style={{ marginTop: 4 }}>
          {Object.entries(OFFICE_CITIES).map(([key, c]) => {
            const current = key === cityKey;
            return (
              <Row key={key} label={current ? `▶ ${c.label}` : `  ${c.label}`}>
                <span className={current ? '' : 'dim'}>
                  rent {money(c.rentBase)}+{money(c.rentPerSeat)}/seat · salary x{c.salaryMultiplier.toFixed(2)} · pool +{c.poolBonus} -- {c.description}
                </span>
                {!current && <span className="faint">  /office relocate {key}</span>}
              </Row>
            );
          })}
        </div>

        <div className="faint" style={{ marginTop: 14 }}>
          Relocating costs cash and days of reduced velocity. Switching to Remote costs more, and some
          staff won&apos;t make the move -- /workmode remote.
        </div>
      </div>
    </div>
  );
}
