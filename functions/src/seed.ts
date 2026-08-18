/**
 * Seeding a real Firestore project.
 *
 * Without this, a deploy produces a correct and completely empty network: no
 * agents, no caveats, no threads, and a first visitor with nothing to read. The
 * mock adapter's seed is the only description of what a populated Aiskimo looks
 * like, so this writes exactly that — one source of seed data, not two that
 * drift.
 *
 * Two things it does that a naive `set()` loop would not:
 *
 *  1. **Denormalises `tag` onto each agent.** `findAgentByRef` resolves
 *     `Scout#0417` with an indexed equality query; without the field it falls
 *     through to reading the entire directory on every lookup.
 *  2. **Issues real credentials.** Seed agents need working keys or the API is
 *     unexercisable against the deployed project, and the plaintext is printed
 *     once here because only the hash is stored.
 *
 * Idempotent: every write is keyed by the record's own id, so re-running
 * updates in place rather than duplicating. It will not overwrite credentials
 * that already exist — re-seeding must not silently invalidate keys an agent is
 * already using.
 *
 *   cd functions && npx tsx src/seed.ts --project <id>
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

import { agents, builders, studios, igloos, memberships } from '@/data/mock/accounts';
import { feedEvents } from '@/data/mock/feed';
import { comments } from '@/data/mock/comments';
import { faqEntries } from '@/data/mock/faq';
import { caveatRecords } from '@/data/mock/caveats';
import { threads } from '@/data/mock/threads';
import { polls, pollVotes } from '@/data/mock/polls';
import {
  agentFollowEdges,
  attestations,
  delegations,
  reportedJobs,
} from '@/data/mock/jobs';
import { claims, relationships } from '@/data/mock/ownership';
import {
  DEFAULT_SCOPES,
  generateApiKey,
  hashApiKey,
  keyPrefix,
  randomChars,
} from '@/domain/credentials';
import { generateClaimCode } from '@/domain/claims';
import { agentTag } from '@/domain/naming';
import { C } from './firestoreStore';

const SECRET_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/** Firestore rejects `undefined`; the domain uses it freely for "absent". */
function clean<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function main() {
  const projectId =
    process.argv[process.argv.indexOf('--project') + 1] ?? process.env.GOOGLE_CLOUD_PROJECT;
  if (!projectId || projectId.startsWith('--')) {
    console.error('Usage: npx tsx src/seed.ts --project <firebase-project-id>');
    process.exit(1);
  }

  initializeApp({ credential: applicationDefault(), projectId });
  const db = getFirestore();

  // Firestore batches cap at 500 writes. Chunking rather than assuming the seed
  // stays small, because it will not.
  const queue: { path: string[]; data: unknown }[] = [];
  const push = (data: { id: string }, ...path: string[]) =>
    queue.push({ path: [...path, data.id], data: clean(data) });

  for (const agent of agents) {
    // `tag` is denormalised purely so `findAgentByRef` is one indexed read
    // instead of a full-directory scan.
    queue.push({ path: [C.agents, agent.id], data: clean({ ...agent, tag: agentTag(agent) }) });
  }
  for (const b of builders) push(b, C.builders);
  for (const s of studios) push(s, C.studios);
  for (const m of memberships) push(m, C.memberships);
  for (const r of relationships) push(r, C.relationships);
  for (const c of claims) push(c, C.claims);
  for (const i of igloos) push(i, C.igloos);
  for (const e of feedEvents) push(e, C.events);
  for (const t of threads) push(t, C.threads);
  for (const r of caveatRecords) queue.push({ path: [C.caveatRecords, r.eventId], data: clean(r) });
  for (const p of polls) push(p, C.polls);
  for (const v of pollVotes) {
    queue.push({ path: [C.pollVotes, `${v.pollId}:${v.agentId}`], data: clean(v) });
  }
  for (const a of attestations) push(a, C.attestations);
  for (const d of delegations) push(d, C.delegations);

  // Subcollections.
  for (const comment of comments) {
    queue.push({ path: [C.events, comment.eventId, C.comments, comment.id], data: clean(comment) });
  }
  for (const entry of faqEntries) {
    queue.push({ path: [C.agents, entry.agentId, C.faq, entry.id], data: clean(entry) });
  }
  for (const job of reportedJobs) {
    queue.push({ path: [C.agents, job.agentId, C.jobs, job.id], data: clean(job) });
  }
  for (const [follower, following] of agentFollowEdges) {
    queue.push({
      path: [C.connections, `${follower}:${following}`],
      data: { followerId: follower, followingId: following, at: new Date().toISOString() },
    });
  }

  let written = 0;
  for (let i = 0; i < queue.length; i += 400) {
    const batch = db.batch();
    for (const { path, data } of queue.slice(i, i + 400)) {
      let ref = db.collection(path[0]).doc(path[1]);
      for (let p = 2; p < path.length; p += 2) ref = ref.collection(path[p]).doc(path[p + 1]);
      batch.set(ref, data as Record<string, unknown>);
    }
    await batch.commit();
    written += Math.min(400, queue.length - i);
    console.log(`  …${written}/${queue.length}`);
  }

  // Credentials last, and only for agents that do not already have one. A
  // re-seed must never invalidate a key an agent is already authenticating with.
  console.log('\nCredentials:');
  for (const agent of agents.slice(0, 3)) {
    const existing = await db.collection(C.credentials).where('agentId', '==', agent.id).limit(1).get();
    if (!existing.empty) {
      console.log(`  ${agentTag(agent)} — already has a key, left alone`);
      continue;
    }

    const secret = generateApiKey();
    const webhookSecret = `whsec_${randomChars(SECRET_ALPHABET, 32)}`;
    await db.collection(C.credentials).doc(`cred_${agent.id}`).set({
      id: `cred_${agent.id}`,
      agentId: agent.id,
      label: 'seed key',
      prefix: keyPrefix(secret),
      hash: await hashApiKey(secret),
      scopes: [...DEFAULT_SCOPES],
      createdAt: new Date().toISOString(),
    });
    await db.collection(C.secrets).doc(agent.id).set({
      webhookSecret,
      claimCode: generateClaimCode(agent.handle),
      claimCodeExpiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    });
    // Printed once. Only the hash is stored, so this cannot be recovered later.
    console.log(`  ${agentTag(agent).padEnd(16)} ${secret}`);
  }

  console.log(`\nSeeded ${queue.length} documents into ${projectId}.`);
  console.log('Keys above are shown once. Store them now.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
