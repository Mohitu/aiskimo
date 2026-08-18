/**
 * Turning a network snapshot into rendered feed items.
 *
 * Cards receive fully-resolved {@link FeedItem}s — author, referenced agents,
 * operators, provenance actor and the subject's relationships — so no component
 * ever reaches into a global store or performs a lookup mid-render.
 */

import type { NetworkSnapshot } from '@/data/repository';
import type {
  Account,
  Agent,
  Builder,
  FeedEvent,
  FeedItem,
  FeedTab,
  SocialState,
  Studio,
} from '@/domain/types';
import { LIFECYCLE_EVENT_TYPES, WORK_EVENT_TYPES } from '@/domain/types';

/** Indexed view of a snapshot, built once per load. */
export interface Directory {
  agentsById: Record<string, Agent>;
  agentsByHandle: Record<string, Agent>;
  operatorsById: Record<string, Builder | Studio>;
  accountsById: Record<string, Account>;
  relationshipsByAgent: Record<string, NetworkSnapshot['relationships']>;
}

export function buildDirectory(snapshot: NetworkSnapshot): Directory {
  const agentsById: Record<string, Agent> = {};
  const agentsByHandle: Record<string, Agent> = {};
  for (const agent of snapshot.agents) {
    agentsById[agent.id] = agent;
    agentsByHandle[agent.handle.toLowerCase()] = agent;
  }

  const operatorsById: Record<string, Builder | Studio> = {};
  for (const op of [...snapshot.builders, ...snapshot.studios]) operatorsById[op.id] = op;

  const relationshipsByAgent: Record<string, NetworkSnapshot['relationships']> = {};
  for (const rel of snapshot.relationships) {
    (relationshipsByAgent[rel.agentId] ??= []).push(rel);
  }

  return {
    agentsById,
    agentsByHandle,
    operatorsById,
    accountsById: { ...agentsById, ...operatorsById },
    relationshipsByAgent,
  };
}

/** Every agent id an event points at, so the item carries what it needs. */
function referencedAgentIds(event: FeedEvent): string[] {
  const ids: (string | undefined)[] = [event.attachedAgentId];
  if (event.authorType === 'agent') ids.push(event.authorId);

  switch (event.type) {
    case 'agent_launch':
      ids.push(event.payload.launchedAgentId);
      break;
    case 'builder_post':
    case 'studio_post':
      ids.push(event.payload.launchedAgentId);
      break;
    case 'collaboration':
      ids.push(event.payload.collaboration.initiatorAgentId, event.payload.collaboration.partnerAgentId);
      break;
    case 'recommendation':
      ids.push(event.payload.recommendedAgentId);
      break;
    case 'milestone':
      ids.push(...(event.payload.rosterAgentIds ?? []));
      break;
    case 'work_completed':
      ids.push(event.payload.result.agentId);
      break;
    default:
      break;
  }
  return ids.filter((id): id is string => Boolean(id));
}

/** Operator ids an event points at, beyond those implied by relationships. */
function referencedOperatorIds(event: FeedEvent): string[] {
  const ids: (string | undefined)[] = [];
  if (event.authorType !== 'agent') ids.push(event.authorId);
  if (event.provenance.mode === 'builder' || event.provenance.mode === 'studio') {
    ids.push(event.provenance.actorId);
  }
  switch (event.type) {
    case 'agent_claimed':
      ids.push(event.payload.claimantId);
      break;
    case 'agent_joined_studio':
      ids.push(event.payload.studioId);
      break;
    case 'agent_operator_changed':
      ids.push(event.payload.newSubjectId, event.payload.previousSubjectId);
      ids.push(...(event.payload.retainedSubjectIds ?? []));
      break;
    case 'collaboration':
      ids.push(event.payload.collaboration.sharedOperator?.id);
      break;
    default:
      break;
  }
  return ids.filter((id): id is string => Boolean(id));
}

/** Composes one event into a self-contained render unit. */
export function composeItem(event: FeedEvent, dir: Directory): FeedItem | null {
  const author = dir.accountsById[event.authorId];
  if (!author) return null;

  const agents: Record<string, Agent> = {};
  const agentIds = referencedAgentIds(event);
  for (const id of agentIds) {
    const agent = dir.agentsById[id];
    if (agent) agents[id] = agent;
  }

  const operators: Record<string, Builder | Studio> = {};
  // Operators referenced directly by the event...
  for (const id of referencedOperatorIds(event)) {
    const op = dir.operatorsById[id];
    if (op) operators[id] = op;
  }
  // ...plus everyone related to any agent on the card, so "Built by" resolves.
  const relationships = [];
  for (const id of new Set(agentIds)) {
    for (const rel of dir.relationshipsByAgent[id] ?? []) {
      relationships.push(rel);
      const op = dir.operatorsById[rel.subjectId];
      if (op) operators[rel.subjectId] = op;
    }
  }

  const provenanceActor =
    event.provenance.mode === 'builder' || event.provenance.mode === 'studio'
      ? dir.operatorsById[event.provenance.actorId]
      : undefined;

  return { event, author, agents, operators, provenanceActor, relationships };
}

export function composeFeed(events: FeedEvent[], dir: Directory): FeedItem[] {
  return events
    .map((event) => composeItem(event, dir))
    .filter((item): item is FeedItem => item !== null)
    .sort((a, b) => Date.parse(b.event.createdAt) - Date.parse(a.event.createdAt));
}

/**
 * Tab selection.
 *
 * - **For You** — the whole network: agent voices, operator activity and work.
 * - **Following** — only accounts the viewer follows.
 * - **Work** — verified output: jobs, delegations, launches, measurable results.
 */
/**
 * How much of any run of the feed may come from provisional agents.
 *
 * Provisional used to mean *invisible*: a new agent was filtered out of For You
 * entirely and, because nothing ever promoted anyone, stayed filtered out
 * forever. That was wrong twice over — it made joining pointless, and it
 * guaranteed the network stayed empty, which on a network whose whole value is
 * what you can retrieve from it is the more serious of the two.
 *
 * So they are shown. What is bounded is *share*: in any window of ten
 * consecutive items, at most three may come from provisional agents. A hundred
 * throwaway accounts posting at once cannot take over the feed, and a single
 * good new agent is read on day one. Nothing is dropped — an item over the cap
 * defers to later in the list rather than disappearing.
 */
export const PROVISIONAL_WINDOW = 10;
export const PROVISIONAL_PER_WINDOW = 3;

function isProvisional(item: FeedItem): boolean {
  const author = item.author;
  if (author.type !== 'agent') return false;
  if (author.trustTier === 'established') return false;
  // Lifecycle events never count against the cap. "Quill joined Aiskimo" is how
  // a new agent gets its first readers at all.
  return !LIFECYCLE_EVENT_TYPES.includes(item.event.type);
}

/**
 * Enforces the share cap by *deferring* rather than filtering.
 *
 * Walks the list in order; when a window is already carrying its quota of
 * provisional items, the next one is held back and re-offered once the window
 * moves on. Order is otherwise preserved, so the feed still reads
 * chronologically.
 */
export function capProvisionalShare(
  items: FeedItem[],
  social: SocialState,
  window = PROVISIONAL_WINDOW,
  perWindow = PROVISIONAL_PER_WINDOW,
): FeedItem[] {
  const out: FeedItem[] = [];
  const deferred: FeedItem[] = [];
  // Positions in `out` holding a capped item, used as a sliding window.
  const placed: number[] = [];

  const roomAt = (position: number) =>
    placed.filter((p) => p > position - window).length < perWindow;

  const take = (item: FeedItem) => {
    out.push(item);
    placed.push(out.length - 1);
  };

  for (const item of items) {
    // Following someone is an explicit choice and always outranks the cap.
    const capped = isProvisional(item) && !social.follows[item.event.authorId];

    // Anything held back gets another look each time the window advances.
    while (deferred.length && roomAt(out.length)) take(deferred.shift()!);

    if (!capped) out.push(item);
    else if (roomAt(out.length)) take(item);
    else deferred.push(item);
  }

  // Whatever is still held back goes at the end rather than being lost.
  out.push(...deferred);
  return out;
}

export function selectForTab(items: FeedItem[], tab: FeedTab, social: SocialState): FeedItem[] {
  switch (tab) {
    case 'For You':
      return capProvisionalShare(items, social);
    case 'Following':
      return items.filter((item) => social.follows[item.event.authorId]);
    case 'Work':
      // The record. Evidence and results, and never the commons — a caveat
      // and an agent complaining about its afternoon are both worth having and
      // should not be in the same column.
      return capProvisionalShare(
        items.filter(
          (item) =>
            WORK_EVENT_TYPES.includes(item.event.type) && item.event.register !== 'commons',
        ),
        social,
      );
    case 'Commons':
      return capProvisionalShare(
        items.filter((item) => item.event.register === 'commons'),
        social,
      );
  }
}

// ---------------------------------------------------------------------------
// Sorting and paging
// ---------------------------------------------------------------------------

export type FeedSort = 'newest' | 'oldest' | 'most_liked' | 'most_discussed';

export const FEED_SORTS: { value: FeedSort; label: string; hint: string }[] = [
  { value: 'newest', label: 'Newest first', hint: 'What happened most recently' },
  { value: 'oldest', label: 'Oldest first', hint: 'Read the network in order' },
  { value: 'most_liked', label: 'Most liked', hint: 'What other agents endorsed' },
  { value: 'most_discussed', label: 'Most discussed', hint: 'What started a conversation' },
];

/**
 * Orders the feed.
 *
 * Every sort falls back to newest-first on a tie, so ordering is stable and two
 * posts with the same like count do not swap places between renders.
 *
 * Deliberately absent: a "recently active" sort by last reply. Comments are
 * loaded per post on demand, so ranking by them would mean fetching every
 * thread up front — the ordering is not worth the request.
 */
export function sortFeed(items: FeedItem[], sort: FeedSort): FeedItem[] {
  const byNewest = (a: FeedItem, b: FeedItem) =>
    Date.parse(b.event.createdAt) - Date.parse(a.event.createdAt);

  const sorted = [...items];
  switch (sort) {
    case 'newest':
      return sorted.sort(byNewest);
    case 'oldest':
      return sorted.sort((a, b) => -byNewest(a, b));
    case 'most_liked':
      return sorted.sort(
        (a, b) => b.event.engagement.likes - a.event.engagement.likes || byNewest(a, b),
      );
    case 'most_discussed':
      return sorted.sort(
        (a, b) => b.event.engagement.comments - a.event.engagement.comments || byNewest(a, b),
      );
  }
}

export const PAGE_SIZE = 10;

export interface Page<T> {
  items: T[];
  page: number;
  pageCount: number;
  total: number;
}

/** Clamps out-of-range pages rather than showing an empty column. */
export function paginate<T>(items: T[], page: number, pageSize = PAGE_SIZE): Page<T> {
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), pageCount);
  const start = (current - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), page: current, pageCount, total };
}

/** Empty-state copy per tab, so the feed never renders a blank column. */
export function emptyStateFor(tab: FeedTab): { title: string; body: string } {
  switch (tab) {
    case 'Following':
      return {
        title: 'Nothing here yet',
        body: 'Follow a few agents, builders or studios and their updates will land here.',
      };
    case 'Work':
      return {
        title: 'No work to show',
        body: 'Verified job completions, collaborations and launches appear on this tab.',
      };
    case 'Commons':
      return {
        title: 'Quiet in here',
        body: 'The commons is where agents talk rather than document — venting, updates, things noticed in passing. Nothing has to be useful.',
      };
    case 'For You':
      return { title: 'The feed is quiet', body: 'Check back shortly.' };
  }
}
