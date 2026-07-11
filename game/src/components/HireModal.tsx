import { Candidate, DeveloperRole } from '@/lib/types';

interface HireModalProps {
  candidates: Candidate[];
  onClose: () => void;
  onHire: (candidateId: string) => void;
}

const roleColors: Record<DeveloperRole, string> = {
  frontend:  '#00d4ff',
  backend:   '#00ff88',
  fullstack: '#a78bfa',
  devops:    '#ffaa00',
  ml:        '#f472b6',
  dba:       '#fb923c',
};

function VelocityDots({ value }: { value: number }) {
  return (
    <div style={{ display: 'flex', gap: 3 }}>
      {Array.from({ length: 10 }).map((_, i) => (
        <div
          key={i}
          style={{
            width: 8, height: 8, borderRadius: 2,
            background: i < value ? '#00ff88' : '#1e2433',
          }}
        />
      ))}
    </div>
  );
}

export default function HireModal({ candidates, onClose, onHire }: HireModalProps) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        background: '#0d0f14e8',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div
        className="modal-header"
        style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid #1e2433', gap: 12 }}
      >
        <span style={{ color: '#00ff88', fontSize: 14, letterSpacing: '0.1em', fontWeight: 700 }}>
          👤 HIRING BOARD
        </span>
        <span style={{ color: '#4a5568', fontSize: 12 }}>— {candidates.length} applicant{candidates.length !== 1 ? 's' : ''}</span>
        <button
          id="hire-close"
          onClick={onClose}
          style={{
            marginLeft: 'auto', background: '#1a1f2e', border: '1px solid #2d3748',
            color: '#718096', borderRadius: 6, padding: '4px 14px',
            fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          ESC — Close
        </button>
      </div>

      {/* Candidate Grid */}
      <div
        className="candidate-grid"
        style={{
          flex: 1,
          overflowY: 'auto',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 16,
          alignContent: 'start',
        }}
      >
        {candidates.length === 0 && (
          <div style={{ color: '#4a5568', fontSize: 13, gridColumn: '1/-1', textAlign: 'center', marginTop: 40 }}>
            No applicants yet. The LLM will surface candidates over time.
          </div>
        )}

        {candidates.map(candidate => {
          const rc = roleColors[candidate.role];
          return (
            <div
              key={candidate.id}
              style={{
                background: '#161922',
                border: `1px solid ${rc}30`,
                borderRadius: 10,
                padding: '18px 20px',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              {/* Name + Role */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ color: '#e2e8f0', fontSize: 15, fontWeight: 600 }}>{candidate.name}</div>
                  <div style={{ color: '#718096', fontSize: 11, marginTop: 2 }}>{candidate.level} level</div>
                </div>
                <span
                  style={{
                    background: `${rc}20`, color: rc, border: `1px solid ${rc}40`,
                    borderRadius: 5, padding: '3px 10px', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
                  }}
                >
                  {candidate.role.toUpperCase()}
                </span>
              </div>

              {/* Blurb */}
              <div style={{ color: '#718096', fontSize: 12, lineHeight: 1.5 }}>{candidate.blurb}</div>

              {/* Stats */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ color: '#4a5568', fontSize: 11, letterSpacing: '0.08em' }}>VELOCITY</span>
                  <VelocityDots value={candidate.velocity} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ color: '#4a5568', fontSize: 11, letterSpacing: '0.08em' }}>SALARY</span>
                  <span style={{ color: '#ff4466', fontSize: 13, fontWeight: 600 }}>
                    ${candidate.salary.toLocaleString()}<span style={{ color: '#4a5568', fontSize: 10 }}>/mo</span>
                  </span>
                </div>
              </div>

              {/* Hire Button */}
              <button
                id={`hire-btn-${candidate.id}`}
                onClick={() => onHire(candidate.id)}
                style={{
                  background: `${rc}18`, border: `1px solid ${rc}60`, color: rc,
                  borderRadius: 6, padding: '8px 0', fontSize: 12, fontWeight: 600,
                  cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '0.08em',
                  transition: 'background 0.2s',
                }}
                onMouseEnter={e => { (e.target as HTMLButtonElement).style.background = `${rc}30`; }}
                onMouseLeave={e => { (e.target as HTMLButtonElement).style.background = `${rc}18`; }}
              >
                HIRE — +${candidate.salary.toLocaleString()}/mo burn
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
