/**
 * The Flavor Queue (ADR-0001). The LLM writes titles and names into this buffer
 * in the background; the simulation pops from it synchronously when it Rolls, so
 * model latency is never on the player's critical path. When the buffer runs dry
 * -- or the endpoint is down -- these built-in tables take over and the game
 * carries on unchanged.
 */

import { Rng } from './rng';
import { Discipline, FlavorItem, FlavorQueue, PersonFlavor, TicketType } from './types';

export const flavorKey = (type: TicketType, discipline: Discipline) => `${type}:${discipline}`;

export function emptyQueue(): FlavorQueue {
  return { tickets: {}, people: [], usedTitles: [], offline: false };
}

// ─── Fallback tables ─────────────────────────────────────────────────────────

const SUBJECT: Record<Discipline, string[]> = {
  frontend: ['the settings panel', 'the onboarding flow', 'the data grid', 'the chart legend', 'the mobile nav', 'the upload widget'],
  backend:  ['the auth service', 'the webhook dispatcher', 'the billing worker', 'the search API', 'the export job', 'the rate limiter'],
  devops:   ['the deploy pipeline', 'the staging cluster', 'log ingestion', 'the build cache', 'certificate renewal', 'the autoscaler'],
  ml:       ['the ranking model', 'the embedding index', 'the training loop', 'the feature store', 'churn prediction', 'the eval harness'],
  dba:      ['the primary replica', 'the migration runner', 'the connection pool', 'the archive table', 'the query planner', 'the backup job'],
};

const BUG_SYMPTOM = [
  'drops requests under load', 'leaks memory overnight', 'double-fires on retry',
  'times out past 10k rows', 'returns stale reads', 'silently swallows errors',
  'deadlocks on concurrent writes', 'breaks on daylight-saving boundaries',
];

const FEATURE_VERB = ['Ship', 'Add', 'Build', 'Launch', 'Introduce', 'Roll out'];
const FEATURE_NOUN = [
  'bulk actions for', 'audit logging for', 'a self-serve flow for', 'usage metering for',
  'saved views for', 'role-based access to', 'an SLA dashboard for', 'webhooks for',
];

const DEBT_VERB = ['Untangle', 'Retire', 'Consolidate', 'Rewrite', 'Decouple', 'Document'];
const DEBT_NOUN = [
  'the copy-pasted retry logic in', 'the three config systems behind', 'the dead feature flags in',
  'the untested edge cases in', 'the hand-rolled cache in', 'the last jQuery holdout in',
];

const FIRST = [
  'Ava', 'Marcus', 'Priya', 'Jordan', 'Sam', 'Lee', 'Nadia', 'Theo', 'Ines', 'Omar',
  'Rin', 'Casey', 'Mila', 'Iris', 'Yuki', 'Farah', 'Kofi', 'Elena', 'Ravi', 'Tom',
];
const LAST = [
  'Chen', 'Webb', 'Nair', 'Riley', 'Torres', 'Nakamura', 'Osei', 'Vance', 'Duarte',
  'Kaur', 'Lindqvist', 'Okafor', 'Reyes', 'Bianchi', 'Novak', 'Haddad',
];
const BLURB = [
  'Ex-infra at a payments company. Allergic to meetings.',
  'Came up through support, so ships with the user in mind.',
  'Wrote the internal tool everyone at their last job still uses.',
  'Quiet in standup, terrifying in code review.',
  'Left a bigger salary for a smaller codebase.',
  'Has opinions about tracing. Correct ones.',
  'Maintains two packages you already depend on.',
  'Recovering consultant. Genuinely likes migrations.',
];

function fallbackTicket(rng: Rng, type: TicketType, discipline: Discipline): FlavorItem {
  const subject = rng.pick(SUBJECT[discipline])!;
  if (type === 'bug') {
    const symptom = rng.pick(BUG_SYMPTOM)!;
    const title = `${subject[0].toUpperCase()}${subject.slice(1)} ${symptom}`;
    return { title, description: `Reported in production. ${title}.` };
  }
  if (type === 'tech_debt') {
    const title = `${rng.pick(DEBT_VERB)!} ${rng.pick(DEBT_NOUN)!} ${subject}`;
    return { title, description: `Slowing every change that touches ${subject}.` };
  }
  const title = `${rng.pick(FEATURE_VERB)!} ${rng.pick(FEATURE_NOUN)!} ${subject}`;
  return { title, description: `Requested by customers on ${subject}.` };
}

function fallbackPerson(rng: Rng): PersonFlavor {
  return {
    name: `${rng.pick(FIRST)!} ${rng.pick(LAST)!}`,
    blurb: rng.pick(BLURB)!,
  };
}

// ─── Popping ─────────────────────────────────────────────────────────────────

const norm = (s: string) => s.toLowerCase().trim();

/**
 * Takes one Flavor item, mutating the queue. Falls back to the built-in tables
 * when the bucket is empty. Never returns a title already used this Run --
 * which is the whole of the deduplication problem now that the LLM no longer
 * authors tickets.
 */
export function popTicketFlavor(
  queue: FlavorQueue,
  rng: Rng,
  type: TicketType,
  discipline: Discipline,
): FlavorItem {
  const bucket = queue.tickets[flavorKey(type, discipline)] ?? [];
  const used = new Set(queue.usedTitles);

  while (bucket.length > 0) {
    const item = bucket.shift()!;
    if (!used.has(norm(item.title))) {
      queue.usedTitles.push(norm(item.title));
      return item;
    }
  }

  for (let attempt = 0; attempt < 12; attempt++) {
    const item = fallbackTicket(rng, type, discipline);
    if (!used.has(norm(item.title))) {
      queue.usedTitles.push(norm(item.title));
      return item;
    }
  }
  // Exhausted the table: disambiguate rather than block the Roll.
  const item = fallbackTicket(rng, type, discipline);
  item.title = `${item.title} (${rng.int(2, 99)})`;
  queue.usedTitles.push(norm(item.title));
  return item;
}

export function popPersonFlavor(queue: FlavorQueue, rng: Rng): PersonFlavor {
  const used = new Set(queue.usedTitles);
  while (queue.people.length > 0) {
    const person = queue.people.shift()!;
    if (!used.has(norm(person.name))) {
      queue.usedTitles.push(norm(person.name));
      return person;
    }
  }
  for (let attempt = 0; attempt < 20; attempt++) {
    const person = fallbackPerson(rng);
    if (!used.has(norm(person.name))) {
      queue.usedTitles.push(norm(person.name));
      return person;
    }
  }
  return fallbackPerson(rng);
}

/** Total buffered items, used to decide when to refill. */
export function queueDepth(queue: FlavorQueue): number {
  const tickets = Object.values(queue.tickets).reduce((sum, b) => sum + b.length, 0);
  return tickets + queue.people.length;
}
