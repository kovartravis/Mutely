/**
 * Fills the Flavor Queue in the background (ADR-0001).
 *
 * This is the ONLY place the LLM touches the game, and it can only contribute
 * words. It never returns a number, so a bad or absent model degrades the prose
 * and nothing else.
 */

import { Discipline, DISCIPLINES, FlavorItem, flavorKey, PersonFlavor, TicketType } from '@/sim';

export interface LLMConfig {
  endpoint: string;
  apiKey: string;
  model: string;
}

export const DEFAULT_LLM: LLMConfig = {
  endpoint: 'http://192.168.1.104:11434/v1/chat/completions',
  apiKey: '',
  model: 'qwen2.5-coder-7b-instruct-4bit',
};

const SYSTEM = `You write flavour text for a startup simulation game. You invent NAMES ONLY.
You never invent numbers, severities, sizes, salaries, or any game mechanic.
Reply with a JSON array and nothing else.`;

function ticketPrompt(type: TicketType, discipline: Discipline, count: number): string {
  const kind =
    type === 'bug' ? 'production bugs' : type === 'tech_debt' ? 'tech-debt clean-ups' : 'product features';
  return `Write ${count} distinct ${kind} for the ${discipline} area of a B2B SaaS product.
Return JSON: [{"title": "short imperative title, max 60 chars", "description": "one sentence, max 120 chars"}]
No numbering, no markdown, no story points, no dollar amounts.`;
}

const PEOPLE_PROMPT = `Write 6 fictional software engineer candidates.
Return JSON: [{"name": "First Last", "blurb": "one sentence about them, max 90 chars"}]
No salaries, no seniority labels, no skill ratings.`;

async function ask(config: LLMConfig, prompt: string, signal: AbortSignal): Promise<unknown[]> {
  const response = await fetch('/api/proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      endpoint: config.endpoint,
      headers: config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {},
      body: {
        model: config.model,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: prompt },
        ],
        temperature: 0.9,
      },
    }),
  });

  if (!response.ok) throw new Error(`proxy ${response.status}`);
  const data = await response.json();
  const text: string = data?.choices?.[0]?.message?.content ?? '';

  // Models wrap JSON in prose or fences often enough that this is worth doing.
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('no JSON array in response');
  const parsed = JSON.parse(match[0]);
  return Array.isArray(parsed) ? parsed : [];
}

const str = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '';

export interface FlavorBatch {
  tickets: Record<string, FlavorItem[]>;
  people: PersonFlavor[];
}

/** Fetches one batch. Throws only on total failure; partial results are kept. */
export async function fetchFlavorBatch(config: LLMConfig, signal: AbortSignal): Promise<FlavorBatch> {
  const batch: FlavorBatch = { tickets: {}, people: [] };

  const type: TicketType = (['feature', 'bug', 'tech_debt'] as const)[Math.floor(Math.random() * 3)];
  const discipline: Discipline = DISCIPLINES[Math.floor(Math.random() * DISCIPLINES.length)];

  const [ticketRows, peopleRows] = await Promise.all([
    ask(config, ticketPrompt(type, discipline, 6), signal).catch(() => []),
    ask(config, PEOPLE_PROMPT, signal).catch(() => []),
  ]);

  const items = ticketRows
    .map((row) => {
      const r = row as Record<string, unknown>;
      return { title: str(r.title, 60), description: str(r.description, 120) };
    })
    .filter((i) => i.title.length > 3);
  if (items.length > 0) batch.tickets[flavorKey(type, discipline)] = items;

  batch.people = peopleRows
    .map((row) => {
      const r = row as Record<string, unknown>;
      return { name: str(r.name, 40), blurb: str(r.blurb, 90) };
    })
    .filter((p) => p.name.length > 2);

  if (items.length === 0 && batch.people.length === 0) throw new Error('empty batch');
  return batch;
}
