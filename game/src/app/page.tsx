'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  apply, finances, newRun, pushEvent, queueDepth, RunState, SIM, tick,
} from '@/sim';
import { AUTOSAVE, listSaves, readSave, saveNames, writeSave } from '@/lib/saves';
import { DEFAULT_LLM, fetchFlavorBatch } from '@/lib/flavorClient';
import Header from '@/components/Header';
import Metrics from '@/components/Metrics';
import TeamPanel from '@/components/TeamPanel';
import ArchitecturePanel from '@/components/ArchitecturePanel';
import BoardPanel from '@/components/BoardPanel';
import Terminal from '@/components/Terminal';
import ArchitectureOverlay from '@/components/ArchitectureOverlay';
import OfficeOverlay from '@/components/OfficeOverlay';
import RemoteOverlay from '@/components/RemoteOverlay';

/** Real milliseconds per simulated Day at 1x. */
const DAY_MS = 2200;

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

export default function GamePage() {
  // Created in an effect, not in useState, so the Seed is never generated during
  // SSR -- otherwise server and client disagree and hydration fails.
  const [state, setState] = useState<RunState | null>(null);
  const [slots, setSlots] = useState<string[]>([]);
  const [overlay, setOverlay] = useState<'none' | 'architecture' | 'office' | 'remote'>('none');

  useEffect(() => {
    // Deliberate: the Run must be created after hydration. A Seed generated
    // during SSR would differ from the client's and blow up hydration, and the
    // autosave lives in localStorage, which does not exist on the server.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(readSave(AUTOSAVE) ?? newRun());
    setSlots(saveNames());
  }, []);

  // ─── Clock ────────────────────────────────────────────────────────────────
  // Keyed on status and speed alone. Depending on `state` would rebuild the
  // interval on every Day, restarting the timer before it ever completes.
  const status = state?.status;
  const speed = state?.speed ?? 0;
  useEffect(() => {
    if (status !== 'running' || speed === 0) return;
    const interval = setInterval(() => {
      setState((prev) => (prev && prev.status === 'running' ? tick(prev) : prev));
    }, DAY_MS / speed);
    return () => clearInterval(interval);
  }, [status, speed]);

  // ─── Autosave ─────────────────────────────────────────────────────────────
  const lastAutosave = useRef(0);
  useEffect(() => {
    if (!state) return;
    if (state.day - lastAutosave.current < 5) return;
    lastAutosave.current = state.day;
    writeSave(AUTOSAVE, state);
  }, [state]);

  // ─── Flavor Queue refill ──────────────────────────────────────────────────
  // The only place the LLM touches the game, and it can only contribute words.
  const refilling = useRef(false);
  useEffect(() => {
    if (!state || refilling.current) return;
    if (queueDepth(state.flavor) >= SIM.flavorRefillAt) return;

    refilling.current = true;
    const controller = new AbortController();

    fetchFlavorBatch(DEFAULT_LLM, controller.signal)
      .then((batch) => {
        setState((prev) => {
          if (!prev) return prev;
          const tickets = { ...prev.flavor.tickets };
          for (const [key, items] of Object.entries(batch.tickets)) {
            tickets[key] = [...(tickets[key] ?? []), ...items].slice(0, SIM.flavorTarget);
          }
          return {
            ...prev,
            flavor: {
              ...prev.flavor,
              tickets,
              people: [...prev.flavor.people, ...batch.people].slice(0, SIM.flavorTarget),
              offline: false,
            },
          };
        });
      })
      .catch(() => {
        // Endpoint down: the built-in phrase tables take over and play continues.
        setState((prev) => (prev && !prev.flavor.offline
          ? { ...prev, flavor: { ...prev.flavor, offline: true } }
          : prev));
      })
      .finally(() => {
        refilling.current = false;
      });

    return () => controller.abort();
  }, [state]);

  // ─── Commands ─────────────────────────────────────────────────────────────
  const stateRef = useRef<RunState | null>(null);
  useEffect(() => { stateRef.current = state; }, [state]);

  const onCommand = useCallback((input: string) => {
    const current = stateRef.current;
    if (!current) return;

    const { state: next, effect } = apply(current, input);

    if (effect) {
      switch (effect.kind) {
        case 'save': {
          if (writeSave(effect.name, next)) {
            pushEvent(next, 'good', `Saved "${effect.name}" — day ${next.day}, ${money(next.cash)}.`);
            setSlots(saveNames());
          } else {
            pushEvent(next, 'alarm', 'Could not write to local storage.');
          }
          break;
        }
        case 'load': {
          const loaded = readSave(effect.name);
          if (!loaded) {
            pushEvent(next, 'alarm', `No save called "${effect.name}". /saves to list.`);
            break;
          }
          pushEvent(loaded, 'good', `Loaded "${effect.name}" — day ${loaded.day}. Paused. /resume`);
          setState(loaded);
          return;
        }
        case 'list_saves': {
          const saves = listSaves();
          if (saves.length === 0) {
            pushEvent(next, 'reply', 'No saves yet. /save <name>');
          } else {
            pushEvent(next, 'reply', 'SAVES');
            for (const s of saves) {
              pushEvent(next, 'reply', `  ${s.name.padEnd(18)}day ${String(s.day).padStart(4)}  ${money(s.cash).padStart(12)}  ${money(s.mrr)}/mo`);
            }
          }
          break;
        }
        case 'restart': {
          const fresh = newRun();
          writeSave(AUTOSAVE, fresh);
          setState(fresh);
          return;
        }
        case 'toggle_overlay': {
          setOverlay((current) => (current === effect.overlay ? 'none' : effect.overlay));
          break;
        }
      }
    }

    setState(next);
  }, []);

  // Escape closes whichever overlay covers the dashboard (architecture, office,
  // remote) -- ADR-0002: still no clicking, just a second way to dismiss
  // besides retyping the command.
  useEffect(() => {
    if (overlay === 'none') return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOverlay('none'); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [overlay]);

  if (!state) {
    return (
      <div className="crt-screen" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <span className="faint">booting…</span>
      </div>
    );
  }

  return (
    <>
      <div className="crt-screen">
        <Header state={state} />
        <Metrics state={state} finances={finances(state)} />

        {overlay === 'architecture' ? (
          <ArchitectureOverlay state={state} />
        ) : overlay === 'office' ? (
          <OfficeOverlay state={state} />
        ) : overlay === 'remote' ? (
          <RemoteOverlay state={state} />
        ) : (
          <div className="stage-grid">
            <div className="left-stack">
              <BoardPanel state={state} />
            </div>
            <div className="right-stack">
              <TeamPanel state={state} />
              <ArchitecturePanel state={state} />
            </div>
          </div>
        )}

        <Terminal state={state} saveNames={slots} onCommand={onCommand} />
      </div>

      {/* Scanlines and vignette sit above everything and take no input. */}
      <div className="crt-overlay" aria-hidden="true" />
    </>
  );
}
