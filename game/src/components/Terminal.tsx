'use client';

import { useRef, useState, useEffect, KeyboardEvent } from 'react';
import { TerminalLine } from '@/lib/types';

interface TerminalProps {
  history: TerminalLine[];
  onCommand: (cmd: string) => void;
}

const COMMANDS = ['/hire', '/backlog', '/pause', '/resume', '/settings', '/help'];

const lineColor: Record<TerminalLine['type'], string> = {
  input:  '#718096',
  output: '#00ff88',
  error:  '#ff4466',
  event:  '#00d4ff',
};

export default function Terminal({ history, onCommand }: TerminalProps) {
  const [input, setInput] = useState('');
  const [histIdx, setHistIdx] = useState(-1);
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const [suggestion, setSuggestion] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [history]);

  useEffect(() => {
    // Tab autocomplete suggestion
    if (input.startsWith('/')) {
      const match = COMMANDS.find(c => c.startsWith(input) && c !== input);
      setSuggestion(match ? match.slice(input.length) : '');
    } else {
      setSuggestion('');
    }
  }, [input]);

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const cmd = input.trim();
      if (!cmd) return;
      onCommand(cmd);
      setCmdHistory(prev => [cmd, ...prev]);
      setInput('');
      setHistIdx(-1);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      if (suggestion) setInput(input + suggestion);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const next = Math.min(histIdx + 1, cmdHistory.length - 1);
      setHistIdx(next);
      setInput(cmdHistory[next] ?? '');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = Math.max(histIdx - 1, -1);
      setHistIdx(next);
      setInput(next === -1 ? '' : cmdHistory[next]);
    } else if (e.key === 'Escape') {
      setInput('');
      setSuggestion('');
    }
  };

  return (
    <div
      id="terminal-panel"
      style={{
        background: '#080a0e',
        borderTop: '1px solid #1e2433',
        height: '20vh',
        minHeight: 120,
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        position: 'relative',
        zIndex: 10,
      }}
      onClick={() => inputRef.current?.focus()}
    >
      {/* Terminal Header */}
      <div
        style={{
          display: 'flex', alignItems: 'center', padding: '5px 16px',
          borderBottom: '1px solid #11141a', gap: 8,
        }}
      >
        <div style={{ display: 'flex', gap: 5 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#ff4466' }} />
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#ffaa00' }} />
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#00ff88' }} />
        </div>
        <span style={{ color: '#2d3748', fontSize: 10, letterSpacing: '0.1em', marginLeft: 4 }}>TERMINAL</span>
      </div>

      {/* Output History */}
      <div
        ref={scrollRef}
        style={{
          flex: 1, overflowY: 'auto', padding: '8px 16px',
          display: 'flex', flexDirection: 'column', gap: 3,
        }}
      >
        {history.slice(-30).map((line, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            {line.type === 'input' && (
              <span style={{ color: '#2d3748', flexShrink: 0 }}>›</span>
            )}
            <span
              style={{
                color: lineColor[line.type],
                fontSize: 12,
                lineHeight: 1.5,
                opacity: line.type === 'input' ? 0.6 : 1,
              }}
            >
              {line.text}
            </span>
          </div>
        ))}
      </div>

      {/* Input Row */}
      <div
        style={{
          padding: '6px 16px 8px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          borderTop: '1px solid #11141a',
          position: 'relative',
        }}
      >
        <span style={{ color: '#00ff88', fontSize: 13, flexShrink: 0 }}>›</span>
        <div style={{ flex: 1, position: 'relative' }}>
          <input
            id="terminal-input"
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            autoComplete="off"
            spellCheck={false}
            style={{
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: '#e2e8f0',
              fontSize: 13,
              fontFamily: 'inherit',
              width: '100%',
              caretColor: '#00ff88',
            }}
            placeholder=""
          />
          {/* Ghost suggestion overlay */}
          {suggestion && (
            <span
              style={{
                position: 'absolute',
                left: `${input.length}ch`,
                top: 0,
                color: '#2d3748',
                fontSize: 13,
                fontFamily: 'inherit',
                pointerEvents: 'none',
                lineHeight: '1.4',
              }}
            >
              {suggestion}
            </span>
          )}
        </div>

        {/* Hint */}
        <div
          className="terminal-hints"
          style={{ display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}
        >
          {COMMANDS.map(cmd => (
            <span key={cmd} style={{ color: '#2d3748', fontSize: 10, letterSpacing: '0.05em' }}>
              {cmd}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
