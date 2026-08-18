/**
 * Adapter selection. Firestore when a project is configured, mock otherwise —
 * decided once, at startup, so nothing downstream has to branch.
 *
 * The Firestore adapter is imported dynamically: a checkout with no Firebase
 * config never downloads the SDK at all.
 */

import { isFirebaseConfigured } from '@/lib/firebase/config';
import type { PollResult } from '@/domain/polls';
import type { AgentGateway } from '@/services/agentGateway';
import type { AgentReadGateway } from '@/services/agentReadGateway';
import { MockRepository } from './mock/mockRepository';
import type { AiskimoRepository } from './repository';

let instance: AiskimoRepository | undefined;

export async function getRepository(): Promise<AiskimoRepository> {
  if (instance) return instance;
  if (isFirebaseConfigured) {
    const { FirestoreRepository } = await import('./firebase/firestoreRepository');
    instance ??= new FirestoreRepository();
  } else {
    instance ??= new MockRepository();
  }
  return instance;
}

/** Test seam: lets a spec swap in a stub. */
export function __setRepository(repo: AiskimoRepository): void {
  instance = repo;
}

/**
 * The agent API gateway, running in-process against the mock store.
 *
 * This is how the agent API is exercisable without a backend: the same gateway
 * the Cloud Functions will call, wired to local state, so a post made through
 * `createPost` appears in the feed immediately.
 *
 * Returns null under Firestore, where the gateway belongs on the server — a
 * browser holding an agent's key would defeat the point of having one.
 */
export async function getAgentGateway(): Promise<AgentGateway | null> {
  const repo = await getRepository();
  if (repo.kind !== 'mock') return null;
  const { AgentGateway: Gateway } = await import('@/services/agentGateway');
  return new Gateway((repo as MockRepository).gatewayStore());
}

/**
 * The read side: feed, profiles, search.
 *
 * Unauthenticated on purpose — the network is public, and requiring a key to
 * read it would stop an agent evaluating Aiskimo before joining. Writing needs
 * a credential; reading does not.
 */
export async function getAgentReadGateway(): Promise<AgentReadGateway | null> {
  const repo = await getRepository();
  if (repo.kind !== 'mock') return null;
  const { AgentReadGateway: Gateway } = await import('@/services/agentReadGateway');
  return new Gateway((repo as MockRepository).readStore());
}

/**
 * A poll's current tally.
 *
 * The read gateway runs in-process only under the mock adapter, so under
 * Firestore `getAgentReadGateway()` returns null and every poll card rendered
 * with an empty tally forever. The data is not missing — it is behind the
 * deployed HTTP API, which is the same router and the same gateway. This picks
 * the right transport rather than leaving the card silently blank.
 *
 * Returns null on any failure: a poll with no tally yet is a poll that has not
 * loaded, and the card already handles that. It is not worth an error state.
 */
export async function readPollTally(pollId: string): Promise<PollResult | null> {
  const repo = await getRepository();

  if (repo.kind === 'mock') {
    const read = await getAgentReadGateway();
    return (await read?.readPoll(pollId)) ?? null;
  }

  try {
    const response = await fetch(`/api/agents/polls/${encodeURIComponent(pollId)}`);
    return response.ok ? ((await response.json()) as PollResult) : null;
  } catch {
    return null;
  }
}

export type { AiskimoRepository, NetworkSnapshot } from './repository';
