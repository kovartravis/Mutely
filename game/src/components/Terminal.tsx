'use client';

import { KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  ARCHITECTURES, COMMANDS, DB_ENGINE_SPECS, DB_ENGINES, EventLevel, GameEvent, isOpen,
  RunState, RUNTIME_SPECS, RUNTIMES, topDiscipline,
} from '@/sim';

interface TerminalProps {
  state: RunState;
  saveNames: string[];
  onCommand: (input: string) => void;
}

/** Routine levels stay quiet; only alarm states are allowed to bloom. */
const LEVEL_CLASS: Record<EventLevel, string> = {
  command: 'faint',
  reply: '',
  info: 'dim',
  good: 'bloom-ok',
  warn: 'bloom-warn',
  alarm: 'bloom-bug',
};

interface Completion {
  value: string;
  hint: string;
}

/**
 * Completions come from live game objects rather than a static list -- pressing
 * TAB is how the player discovers what exists (ADR-0002).
 */
function completionsFor(state: RunState, saves: string[], input: string): Completion[] {
  const endsWithSpace = /\s$/.test(input);
  const tokens = input.trim().split(/\s+/).filter(Boolean);
  const argIndex = endsWithSpace ? tokens.length - 1 : tokens.length - 2;
  const partial = endsWithSpace ? '' : (tokens[tokens.length - 1] ?? '');

  // Completing the command itself.
  if (tokens.length === 0 || (argIndex < 0 && !endsWithSpace)) {
    return COMMANDS.filter((c) => c.name.startsWith(partial.toLowerCase()))
      .map((c) => ({ value: c.name, hint: c.summary }));
  }

  const spec = COMMANDS.find((c) => c.name === tokens[0].toLowerCase());
  const kind = spec?.args[argIndex];
  if (!kind) return [];

  const strip = partial.replace(/^[@#]/, '').toLowerCase();
  const match = (s: string) => s.toLowerCase().startsWith(strip);

  switch (kind) {
    case 'dev':
      return state.developers.filter((d) => match(d.handle)).map((d) => ({
        value: `@${d.handle}`,
        hint: `${d.level} · ${topDiscipline(d.proficiency)} ${Math.round(d.proficiency[topDiscipline(d.proficiency)])} · morale ${Math.round(d.morale)}${d.noticeDaysLeft !== null ? ' · NOTICE' : ''}`,
      }));
    case 'candidate':
      return state.candidates.filter((c) => match(c.handle)).map((c) => ({
        value: `@${c.handle}`,
        hint: `${c.level} · $${c.salary.toLocaleString()}/mo · ${c.expiresDay - state.day}d left`,
      }));
    case 'ticket':
      return state.tickets.filter((t) => isOpen(t) && match(t.handle)).map((t) => ({
        value: `#${t.handle}`,
        hint: `${t.type.toUpperCase()} · ${t.severity} · ${t.discipline} · ${t.storyPoints}sp · ${t.title}`,
      }));
    case 'automode':
      return [
        { value: 'off', hint: 'stop auto-assigning' },
        { value: 'once', hint: 'assign now, do not stay on' },
      ].filter((c) => match(c.value));
    case 'speed':
      return ['0', '1', '2', '4'].filter(match).map((v) => ({
        value: v,
        hint: v === '0' ? 'paused' : `${v}x`,
      }));
    case 'save':
      return saves.filter(match).map((n) => ({ value: n, hint: 'save slot' }));
    case 'architecture':
      return ARCHITECTURES.filter((a) => a !== state.infra.architecture && match(a)).map((a) => ({
        value: a, hint: 'migrate here',
      }));
    case 'infratarget':
      return ['compute', 'db'].filter(match).map((v) => ({
        value: v, hint: v === 'compute' ? `${state.infra.compute} now` : `${state.infra.dbReplicas} replicas now`,
      }));
    case 'confirm':
      return ['confirm'].filter(match).map((v) => ({ value: v, hint: 'commit this change' }));
    case 'boardfilter':
      return ['all', 'bug', 'feature', 'debt', 'stale'].filter(match).map((v) => ({ value: v, hint: 'filter' }));
    case 'switchaxis':
      return ['db', 'runtime'].filter(match).map((v) => ({ value: v, hint: v === 'db' ? 'database engine' : 'compute runtime' }));
    case 'dbengine': {
      // The second /switch argument depends on the first: db lists engines, runtime lists runtimes.
      const axis = tokens[1]?.toLowerCase();
      if (axis === 'runtime') {
        return RUNTIMES.filter(match).map((r) => ({
          value: r, hint: r === state.infra.runtime ? 'current' : RUNTIME_SPECS[r].description,
        }));
      }
      return DB_ENGINES.filter((e) => DB_ENGINE_SPECS[e].availableOn.includes(state.infra.architecture) && match(e)).map((e) => ({
        value: e, hint: e === state.infra.dbEngine ? 'current' : DB_ENGINE_SPECS[e].description,
      }));
    }
    case 'cacheaction':
      return ['buy', 'upgrade', 'refresh'].filter(match).map((v) => ({ value: v, hint: 'cache' }));
    default:
      return [];
  }
}

export default function Terminal({ state, saveNames, onCommand }: TerminalProps) {
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [active, setActive] = useState(0);
  const [showCompletions, setShowCompletions] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const completions = useMemo(
    () => (showCompletions ? completionsFor(state, saveNames, input).slice(0, 12) : []),
    [showCompletions, state, saveNames, input],
  );

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [state.events]);

  const accept = (completion: Completion) => {
    const endsWithSpace = /\s$/.test(input);
    const tokens = input.split(/\s+/).filter(Boolean);
    if (!endsWithSpace && tokens.length > 0) tokens.pop();
    const next = [...tokens, completion.value].join(' ');
    setInput(`${next} `);
    setShowCompletions(false);
    inputRef.current?.focus();
  };

  const submit = () => {
    const cmd = input.trim();
    if (!cmd) return;
    onCommand(cmd);
    setHistory((h) => [cmd, ...h].slice(0, 60));
    setHistoryIdx(-1);
    setInput('');
    setShowCompletions(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      if (!showCompletions) { setShowCompletions(true); return; }
      if (completions[active]) accept(completions[active]);
      return;
    }

    if (e.key === 'Escape') { setShowCompletions(false); return; }

    if (showCompletions && completions.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % completions.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i - 1 + completions.length) % completions.length); return; }
      if (e.key === 'Enter') { e.preventDefault(); accept(completions[active]); return; }
    }

    if (e.key === 'Enter') { e.preventDefault(); submit(); return; }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const idx = Math.min(historyIdx + 1, history.length - 1);
      if (idx >= 0) { setHistoryIdx(idx); setInput(history[idx]); }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const idx = historyIdx - 1;
      setHistoryIdx(idx);
      setInput(idx >= 0 ? history[idx] : '');
    }
  };

  return (
    <div className="panel" style={{ height: '31vh', minHeight: 190, margin: '0 8px 8px', flexShrink: 0 }}>
      <div className="panel-title">
        <span>TERMINAL</span>
        <span className="faint">TAB completes · ↑↓ history</span>
      </div>

      <div ref={logRef} className="panel-body" onClick={() => inputRef.current?.focus()}>
        <div className="rows">
          {state.events.map((event: GameEvent) => (
            <div key={event.id} className={LEVEL_CLASS[event.level]} style={{ whiteSpace: 'pre-wrap' }}>
              {event.level === 'command' ? (
                <span>&gt; {event.text}</span>
              ) : (
                <>
                  <span className="faint">{String(event.day).padStart(4)} </span>
                  {event.text}
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      <div style={{ position: 'relative', borderTop: '1px solid var(--rule)' }}>
        {showCompletions && completions.length > 0 && (
          <div className="completions">
            {completions.map((c, i) => (
              <div
                key={c.value + i}
                className="completion"
                data-active={i === active}
                onMouseDown={(e) => { e.preventDefault(); accept(c); }}
              >
                <span style={{ minWidth: 88 }}>{c.value}</span>
                <span className="faint" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.hint}</span>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px' }}>
          <span className="faint">&gt;</span>
          <input
            ref={inputRef}
            className="term-input"
            value={input}
            spellCheck={false}
            autoComplete="off"
            autoFocus
            onChange={(e) => { setInput(e.target.value); setActive(0); }}
            onKeyDown={onKeyDown}
          />
          <span className="caret" style={{ color: 'var(--ok)' }}>█</span>
        </div>
      </div>
    </div>
  );
}
