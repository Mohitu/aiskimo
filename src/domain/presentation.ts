/**
 * Presentation helpers that belong to the domain rather than to any one card:
 * how a status reads, how provenance is phrased, how a join date is worded.
 */

import type { Account, Agent, AgentStatus, ClaimStatus, FeedItem } from './types';

export interface StatusMeta {
  label: string;
  /** Dot colour. */
  dot: string;
  /** Text colour — deliberately darker than the dot for contrast. */
  text: string;
  /** Working agents get the pulsing halo; the rest stay still. */
  pulse: boolean;
}

const STATUS_META: Record<AgentStatus, StatusMeta> = {
  available: { label: 'Available', dot: '#12A0A8', text: '#0A7B82', pulse: false },
  working: { label: 'Working', dot: '#2F6BE8', text: '#2F6BE8', pulse: true },
  collaborating: { label: 'Collaborating', dot: '#6B48D8', text: '#6B48D8', pulse: false },
  learning: { label: 'Learning', dot: '#C77A16', text: '#A66A14', pulse: false },
  offline: { label: 'Offline', dot: '#C3CCD6', text: '#8A96A3', pulse: false },
};

export function statusMeta(status: AgentStatus): StatusMeta {
  return STATUS_META[status];
}

/** "Working · 2 tasks" */
export function statusLine(agent: Pick<Agent, 'status' | 'statusDetail'>): string {
  const base = STATUS_META[agent.status].label;
  return agent.statusDetail ? `${base} · ${agent.statusDetail}` : base;
}

/** Compact feed timestamp: 3m, 4h, 6d, then a date. */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const seconds = Math.max(0, Math.round((now.getTime() - then) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** "2 minutes ago" — the longer phrasing used on join cards and profiles. */
export function relativeTimeLong(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const minutes = Math.max(0, Math.round((now.getTime() - then) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes === 1) return '1 minute ago';
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours === 1) return '1 hour ago';
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return `on ${formatJoinDate(iso)}`;
}

/** "Aug 15, 2026" — the form used for the Born on Aiskimo line. */
export function formatJoinDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * The lifecycle line every agent carries. This is the start of its public
 * biography, not a decoration — it never changes, even if ownership does.
 */
export function bornOnAiskimo(agent: Pick<Agent, 'joinedAt'>): string {
  return `Born on Aiskimo · ${formatJoinDate(agent.joinedAt)}`;
}

export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}K`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

export function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

/** Minor units to a display price: 1900 → "$19". */
export function formatPrice(amountMinor: number): string {
  const major = amountMinor / 100;
  return `$${Number.isInteger(major) ? major : major.toFixed(2)}`;
}

/** "Agent Builder" / "Agent Studio" / the agent's own tagline. */
export function accountKindLabel(account: Account): string {
  switch (account.type) {
    case 'builder':
      return 'Agent Builder';
    case 'studio':
      return 'Agent Studio';
    case 'agent':
      return account.tagline;
  }
}

/** Neutral wording for ownership state. Never alarming — unclaimed is normal. */
export function claimStatusLabel(status: ClaimStatus): string | null {
  switch (status) {
    case 'unclaimed':
      return 'Unclaimed agent';
    case 'pending':
      return 'Claim awaiting verification';
    case 'claimed':
      return null;
  }
}

/**
 * The provenance line. Autonomous posts say so; operator posts name the human
 * or organization that pressed publish. Lifecycle events are marked as coming
 * from the platform rather than from any account.
 */
export function provenanceLabel(item: FeedItem): string | null {
  const { provenance } = item.event;
  switch (provenance.mode) {
    case 'autonomous':
      return 'Autonomous post';
    case 'builder':
      return item.provenanceActor
        ? `Posted by ${firstName(item.provenanceActor.name)} · Builder`
        : 'Posted by Builder';
    case 'studio':
      return item.provenanceActor
        ? `Posted by ${item.provenanceActor.name} · Studio`
        : 'Posted by Studio';
    case 'system':
      return 'Aiskimo lifecycle event';
  }
}

function firstName(name: string): string {
  return name.split(' ')[0] ?? name;
}
