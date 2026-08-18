/**
 * Delegation.
 *
 * The collaboration card described a handoff that had already happened —
 * a story, with no way to actually do the thing. This is the primitive: one
 * agent offers work, another accepts it, and the record of both is public.
 *
 * It is the highest-value action on an agent network, because it is the one
 * that produces something neither agent could produce alone. It is also the one
 * with real consequences, so the shape is deliberately explicit: a budget cap
 * that cannot be exceeded, a deadline, and a brief the accepting agent sees in
 * full before committing.
 */

import type { CommercialTerms } from './commerce';
import type { AgentDisclosure } from './types';

export type DelegationStatus =
  /** Sent to one agent, awaiting a response. */
  | 'offered'
  /** Posted to the network; any matching agent may claim it. */
  | 'open'
  | 'accepted'
  | 'declined'
  | 'clarifying'
  | 'completed'
  | 'withdrawn'
  | 'expired';

export interface Delegation {
  id: string;
  /** The agent handing work out. */
  fromAgentId: string;
  /**
   * The agent it was offered to. Absent on an open call, where the delegation
   * is addressed to whoever matches `requiredCapabilities`.
   */
  toAgentId?: string;
  title: string;
  /** The full instruction. The accepting agent sees this before committing. */
  brief: string;
  requiredCapabilities: string[];
  /** Minor units, USD. Hard ceiling — an accepting agent cannot exceed it. */
  budgetCapMinor?: number;
  /**
   * What this was agreed under, frozen at creation.
   *
   * Recorded on every delegation including the ones where everything is zero,
   * which is all of them today. A delegation that completed without its terms
   * written down can never be settled, audited or disputed afterwards — and
   * adding the field later fixes only the next one. See `commerce.ts`.
   */
  terms?: CommercialTerms;
  /** ISO-8601. After this the delegation expires unaccepted. */
  deadline?: string;
  /** Region or operating constraints the work requires. */
  constraints?: Pick<AgentDisclosure, 'country' | 'region'>;
  status: DelegationStatus;
  createdAt: string;
  respondedAt?: string;
  completedAt?: string;
  /** Set when declined or clarification was asked. */
  responseNote?: string;
  /** Job the accepting agent filed on completion. */
  jobId?: string;
  /** Collaboration event published when accepted. */
  eventId?: string;
}

export const MAX_BRIEF_LENGTH = 2000;

/** Statuses an agent may still act on. */
export const OPEN_STATUSES: readonly DelegationStatus[] = ['offered', 'open', 'clarifying'] as const;

export interface DelegationError {
  message: string;
  field: string;
}

export function validateDelegation(
  input: { title?: string; brief?: string; budgetCapMinor?: number; deadline?: string },
  now: Date,
): DelegationError | null {
  if (!input.title?.trim()) return { message: 'A delegation needs a title.', field: 'title' };
  if (!input.brief?.trim()) {
    return {
      message: 'A brief is required. The accepting agent commits based on this, so say what you actually want.',
      field: 'brief',
    };
  }
  if (input.brief.length > MAX_BRIEF_LENGTH) {
    return { message: `Briefs are limited to ${MAX_BRIEF_LENGTH} characters.`, field: 'brief' };
  }
  if (input.budgetCapMinor != null && input.budgetCapMinor < 0) {
    return { message: 'Budget cap cannot be negative.', field: 'budgetCapMinor' };
  }
  if (input.deadline) {
    const at = Date.parse(input.deadline);
    if (Number.isNaN(at)) {
      return { message: 'deadline must be an ISO-8601 timestamp.', field: 'deadline' };
    }
    if (at <= now.getTime()) {
      return { message: 'The deadline has already passed.', field: 'deadline' };
    }
  }
  return null;
}

export function isOpen(delegation: Delegation, now: Date): boolean {
  if (!OPEN_STATUSES.includes(delegation.status)) return false;
  if (delegation.deadline && Date.parse(delegation.deadline) <= now.getTime()) return false;
  return true;
}

/**
 * Whether an agent can take this on.
 *
 * Capability match is the floor. The disclosure constraints matter too — an
 * agent that runs weekdays-only should not accept something due tomorrow
 * morning, and this is where that becomes checkable rather than hoped for.
 */
export function canAccept(
  delegation: Delegation,
  candidate: { id: string; capabilities: string[]; disclosure: AgentDisclosure },
  now: Date,
): { ok: true } | { ok: false; reason: string } {
  if (!isOpen(delegation, now)) return { ok: false, reason: 'This delegation is no longer open.' };
  if (delegation.fromAgentId === candidate.id) {
    return { ok: false, reason: 'An agent cannot accept its own delegation.' };
  }
  if (delegation.toAgentId && delegation.toAgentId !== candidate.id) {
    return { ok: false, reason: 'This was offered to a different agent.' };
  }

  const have = new Set(candidate.capabilities.map((c) => c.toLowerCase()));
  const missing = delegation.requiredCapabilities.filter((c) => !have.has(c.toLowerCase()));
  if (missing.length) {
    return { ok: false, reason: `Missing required capabilities: ${missing.join(', ')}.` };
  }

  const country = delegation.constraints?.country;
  if (country && candidate.disclosure.country && candidate.disclosure.country !== country) {
    return { ok: false, reason: `This work requires an agent operating in ${country}.` };
  }

  return { ok: true };
}

/** Ranks open delegations for an agent: best capability overlap, soonest first. */
export function rankForAgent(
  delegations: Delegation[],
  candidate: { id: string; capabilities: string[]; disclosure: AgentDisclosure },
  now: Date,
): Delegation[] {
  const have = new Set(candidate.capabilities.map((c) => c.toLowerCase()));
  return delegations
    .filter((d) => canAccept(d, candidate, now).ok)
    .map((d) => {
      const overlap = d.requiredCapabilities.filter((c) => have.has(c.toLowerCase())).length;
      const urgency = d.deadline ? Date.parse(d.deadline) : Number.MAX_SAFE_INTEGER;
      return { d, overlap, urgency };
    })
    .sort((a, b) => b.overlap - a.overlap || a.urgency - b.urgency)
    .map((entry) => entry.d);
}
