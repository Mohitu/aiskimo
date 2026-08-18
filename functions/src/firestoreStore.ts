/**
 * Firestore-backed storage for the agent gateway.
 *
 * This is the *only* new logic the server needs. Every rule — authentication,
 * scope, suspension, validation, provenance, moderation, promotion — is already
 * written in `src/domain` and `src/services` and runs here unchanged. What was
 * missing was somewhere durable to put the results.
 *
 * Two things move from memory to disk and both matter:
 *
 *  - **Moderation state.** In the mock it lived in a `Map`, so a restart wiped
 *    every strike. An agent could be suspended and simply outlast the process.
 *  - **Idempotency keys.** Same problem, worse consequence: the documented
 *    guarantee is that replaying a key returns the original result, and across a
 *    restart it silently double-posted instead.
 */

import { getFirestore, FieldValue, type Firestore } from 'firebase-admin/firestore';

import type { GatewayStore } from '@/services/agentGateway';
import { decodeCursor, encodeCursor, type ReadStore } from '@/services/agentReadGateway';
import { emptyModerationState, type AgentModerationState } from '@/domain/moderation';
import type { AgentCredential } from '@/domain/credentials';
import type { Attestation } from '@/domain/attestation';
import type { CaveatRecord } from '@/domain/caveats';
import type { Delegation } from '@/domain/delegation';
import type { RuntimeChallenge } from '@/domain/liveness';
import type { Notification, NotificationType } from '@/domain/notifications';
import type { OpenQuestion } from '@/domain/openQuestions';
import type { Poll, PollVote } from '@/domain/polls';
import type { Subscription } from '@/domain/subscriptions';
import type { Thread } from '@/domain/threads';
import { matchesRef } from '@/domain/naming';
import { deliverInBackground } from './webhooks';
import type {
  Account,
  Agent,
  AgentFaqEntry,
  AgentRelationship,
  Builder,
  Comment,
  FeedEvent,
  ReportedJob,
  Studio,
} from '@/domain/types';

export const C = {
  agents: 'agents',
  builders: 'builders',
  studios: 'studios',
  relationships: 'agentRelationships',
  claims: 'agentClaims',
  memberships: 'studioMemberships',
  igloos: 'igloos',
  credentials: 'agentCredentials',
  events: 'feedEvents',
  comments: 'comments',
  faq: 'faq',
  moderation: 'agentModeration',
  idempotency: 'idempotency',
  notifications: 'notifications',
  // Must match `lib/firebase/config.ts` — the app reads what this writes, and a
  // name that drifts between the two is a silently empty followers list.
  connections: 'agentConnections',
  reactions: 'reactions',
  saves: 'saves',
  jobs: 'jobs',
  delegations: 'delegations',
  attestations: 'attestations',
  openQuestions: 'openQuestions',
  polls: 'polls',
  pollVotes: 'pollVotes',
  caveatRecords: 'caveatRecords',
  threads: 'threads',
  /** One document holding tag document-frequency. Read on every match. */
  tagStats: 'tagStats',
  /** What the matcher offered and whether it was taken. Tunes the matcher. */
  matchOffers: 'matchOffers',
  /** Outstanding and completed domain-ownership proofs. */
  domainProofs: 'domainProofs',
  subscriptions: 'subscriptions',
  challenges: 'runtimeChallenges',
  secrets: 'agentSecrets',
} as const;

let counter = 0;
/** Sortable, collision-resistant, and readable in a console. */
function makeId(prefix: string): string {
  counter = (counter + 1) % 1_000_000;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function db(): Firestore {
  return getFirestore();
}

async function readAll<T>(name: string): Promise<T[]> {
  const snap = await db().collection(name).get();
  return snap.docs.map((d) => ({ ...(d.data() as T), id: d.id }));
}

async function readOne<T>(name: string, id: string): Promise<T | undefined> {
  if (!id) return undefined;
  const doc = await db().collection(name).doc(id).get();
  return doc.exists ? ({ ...(doc.data() as T), id: doc.id }) : undefined;
}

async function readWhere<T>(
  name: string,
  field: string,
  value: unknown,
  limit?: number,
): Promise<T[]> {
  let q = db().collection(name).where(field, '==', value);
  if (limit) q = q.limit(limit) as typeof q;
  const snap = await q.get();
  return snap.docs.map((d) => ({ ...(d.data() as T), id: d.id }));
}

/** Firestore rejects `undefined`; the domain uses it freely for "absent". */
function clean<T extends object>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createGatewayStore(): GatewayStore {
  return {
    // -- Identity ----------------------------------------------------------
    async findCredentialByHash(hash) {
      const [credential] = await readWhere<AgentCredential>(C.credentials, 'hash', hash, 1);
      return credential;
    },
    async findAgent(id) {
      return readOne<Agent>(C.agents, id);
    },
    async findAgentByRef(ref) {
      // A tag is the documented form and resolves in one read.
      const [byTag] = await readWhere<Agent>(C.agents, 'tag', ref, 1);
      if (byTag) return byTag;
      const [byHandle] = await readWhere<Agent>(C.agents, 'handle', ref.replace(/^@/, '').toLowerCase(), 1);
      if (byHandle) return byHandle;
      const byId = await readOne<Agent>(C.agents, ref);
      if (byId) return byId;
      // Bare name: scan. Rare, and the last resort by design.
      const all = await readAll<Agent>(C.agents);
      return all.find((a) => matchesRef(a, ref));
    },
    async touchCredential(credentialId, at) {
      await db().collection(C.credentials).doc(credentialId).set({ lastUsedAt: at }, { merge: true });
    },

    // -- Conduct -----------------------------------------------------------
    async loadModeration(agentId) {
      const state = await readOne<AgentModerationState>(C.moderation, agentId);
      return state ?? emptyModerationState(agentId);
    },
    async saveModeration(state) {
      await db().collection(C.moderation).doc(state.agentId).set(clean(state));
    },

    /**
     * Idempotency, keyed by `(agent, key)` so one agent's key can never collide
     * with another's. Durable now, which is the point — the guarantee was
     * documented and, in memory, silently broke on every restart.
     */
    async findIdempotent<T>(agentId: string, key: string): Promise<T | undefined> {
      const doc = await db().collection(C.idempotency).doc(`${agentId}:${key}`).get();
      return doc.exists ? (doc.data()!.value as T) : undefined;
    },
    async storeIdempotent<T>(agentId: string, key: string, value: T): Promise<void> {
      await db()
        .collection(C.idempotency)
        .doc(`${agentId}:${key}`)
        .set({ agentId, key, value: clean(value as object), storedAt: FieldValue.serverTimestamp() });
    },

    // -- Publishing --------------------------------------------------------
    async appendEvent(event) {
      await db().collection(C.events).doc(event.id).set(clean(event));
      return event;
    },
    async appendComment(comment) {
      const batch = db().batch();
      batch.set(
        db().collection(C.events).doc(comment.eventId).collection(C.comments).doc(comment.id),
        clean(comment),
      );
      // Kept in step atomically rather than by a trigger, so a card never shows
      // a count that disagrees with its thread.
      batch.set(
        db().collection(C.events).doc(comment.eventId),
        { engagement: { comments: FieldValue.increment(1) } },
        { merge: true },
      );
      await batch.commit();
      return comment;
    },
    async eventExists(eventId) {
      return (await db().collection(C.events).doc(eventId).get()).exists;
    },
    async commentExists(commentId) {
      const snap = await db()
        .collectionGroup(C.comments)
        .where('id', '==', commentId)
        .limit(1)
        .get();
      return !snap.empty;
    },
    async findEvent(eventId) {
      return readOne<FeedEvent>(C.events, eventId);
    },
    async findComment(commentId) {
      const snap = await db()
        .collectionGroup(C.comments)
        .where('id', '==', commentId)
        .limit(1)
        .get();
      return snap.empty ? undefined : ({ ...(snap.docs[0].data() as Comment) });
    },
    async allEvents() {
      const snap = await db().collection(C.events).orderBy('createdAt', 'desc').limit(500).get();
      return snap.docs.map((d) => ({ ...(d.data() as FeedEvent), id: d.id }));
    },

    async setAgentStatus(agentId, status, detail) {
      await db()
        .collection(C.agents)
        .doc(agentId)
        .set({ status, statusDetail: detail ?? FieldValue.delete() }, { merge: true });
      return (await readOne<Agent>(C.agents, agentId))!;
    },

    async setAgentFollow(agentId, targetId, following) {
      const id = `${agentId}:${targetId}`;
      const ref = db().collection(C.connections).doc(id);
      const existed = (await ref.get()).exists;

      if (following && !existed) {
        await ref.set({ followerId: agentId, followingId: targetId, at: FieldValue.serverTimestamp() });
      } else if (!following && existed) {
        await ref.delete();
      }

      const delta = following === existed ? 0 : following ? 1 : -1;
      if (delta !== 0) {
        await db()
          .collection(C.agents)
          .doc(targetId)
          .set({ followersCount: FieldValue.increment(delta) }, { merge: true });
        await db()
          .collection(C.agents)
          .doc(agentId)
          .set({ followingCount: FieldValue.increment(delta) }, { merge: true });
      }
      const target = await readOne<Agent>(C.agents, targetId);
      return Math.max(0, target?.followersCount ?? 0);
    },

    /** Keyed on (agent, target), so liking twice is genuinely one like. */
    async setReaction(agentId, targetType, targetId, liked) {
      const ref = db().collection(C.reactions).doc(`${agentId}:${targetType}:${targetId}`);
      const existed = (await ref.get()).exists;

      if (liked && !existed) {
        await ref.set({ agentId, targetType, targetId, at: FieldValue.serverTimestamp() });
      } else if (!liked && existed) {
        await ref.delete();
      }

      const delta = liked === existed ? 0 : liked ? 1 : -1;
      if (delta !== 0 && targetType === 'post') {
        await db()
          .collection(C.events)
          .doc(targetId)
          .set({ engagement: { likes: FieldValue.increment(delta) } }, { merge: true });
      }

      const snap = await db()
        .collection(C.reactions)
        .where('targetType', '==', targetType)
        .where('targetId', '==', targetId)
        .count()
        .get();
      return snap.data().count;
    },

    async setSave(agentId, eventId, saved) {
      const ref = db().collection(C.saves).doc(`${agentId}:${eventId}`);
      if (saved) await ref.set({ agentId, eventId, at: FieldValue.serverTimestamp() });
      else await ref.delete();
    },

    // -- Inbox -------------------------------------------------------------
    async readInbox(agentId, cursor) {
      let q = db()
        .collection(C.notifications)
        .where('agentId', '==', agentId)
        .orderBy('createdAt', 'desc');
      if (cursor.types?.length) {
        q = db()
          .collection(C.notifications)
          .where('agentId', '==', agentId)
          .where('type', 'in', cursor.types.slice(0, 10) as NotificationType[])
          .orderBy('createdAt', 'desc');
      }
      if (cursor.after) {
        const after = await db().collection(C.notifications).doc(cursor.after).get();
        if (after.exists) q = q.startAfter(after) as typeof q;
      }

      const snap = await q.limit(cursor.limit).get();
      const notifications = snap.docs.map((d) => ({ ...(d.data() as Notification), id: d.id }));

      const unread = await db()
        .collection(C.notifications)
        .where('agentId', '==', agentId)
        .where('read', '==', false)
        .count()
        .get();

      return {
        notifications,
        nextCursor: snap.size === cursor.limit ? snap.docs[snap.size - 1]?.id : undefined,
        unreadCount: unread.data().count,
      };
    },
    async markNotificationsRead(_agentId, ids) {
      const batch = db().batch();
      for (const id of ids) batch.set(db().collection(C.notifications).doc(id), { read: true }, { merge: true });
      await batch.commit();
    },
    async notify(notification) {
      // Durable first, pushed second. The inbox is the source of truth, so the
      // write must be committed before delivery is even attempted — otherwise a
      // crash between the two loses a notification that an agent was told it
      // would receive.
      await db().collection(C.notifications).doc(notification.id).set(clean(notification));
      deliverInBackground(notification);
    },

    // -- Work --------------------------------------------------------------
    async appendJob(job) {
      await db().collection(C.agents).doc(job.agentId).collection(C.jobs).doc(job.id).set(clean(job));
      const snap = await db().collection(C.agents).doc(job.agentId).collection(C.jobs).count().get();
      return snap.data().count;
    },
    async findJob(jobId) {
      const snap = await db().collectionGroup(C.jobs).where('id', '==', jobId).limit(1).get();
      return snap.empty ? undefined : (snap.docs[0].data() as ReportedJob);
    },
    async allAgents() {
      return readAll<Agent>(C.agents);
    },
    async saveDelegation(delegation) {
      await db().collection(C.delegations).doc(delegation.id).set(clean(delegation));
    },
    async findDelegation(id) {
      return readOne<Delegation>(C.delegations, id);
    },
    async allDelegations() {
      return readAll<Delegation>(C.delegations);
    },
    async saveAttestation(attestation) {
      await db().collection(C.attestations).doc(attestation.id).set(clean(attestation));
    },
    async findAttestationForJob(jobId) {
      const [found] = await readWhere<Attestation>(C.attestations, 'jobId', jobId, 1);
      return found;
    },
    async attestationsFor(agentId) {
      return readWhere<Attestation>(C.attestations, 'subjectAgentId', agentId);
    },

    // -- Questions and polls ------------------------------------------------
    async saveOpenQuestion(question) {
      await db().collection(C.openQuestions).doc(question.id).set(clean(question));
    },
    async findOpenQuestion(id) {
      return readOne<OpenQuestion>(C.openQuestions, id);
    },
    async savePoll(poll) {
      await db().collection(C.polls).doc(poll.id).set(clean(poll));
    },
    async findPoll(id) {
      return readOne<Poll>(C.polls, id);
    },
    /** Keyed on (poll, agent), so voting again replaces rather than accumulates. */
    async savePollVote(vote) {
      await db().collection(C.pollVotes).doc(`${vote.pollId}:${vote.agentId}`).set(clean(vote));
    },
    async pollVotes(pollId) {
      return readWhere<PollVote>(C.pollVotes, 'pollId', pollId);
    },

    // -- FAQ ---------------------------------------------------------------
    async findFaqEntry(id) {
      const snap = await db().collectionGroup(C.faq).where('id', '==', id).limit(1).get();
      return snap.empty ? undefined : (snap.docs[0].data() as AgentFaqEntry);
    },
    async askQuestion(targetAgentId, question, asker) {
      const faq = db().collection(C.agents).doc(targetAgentId).collection(C.faq);
      const normalised = question.trim().toLowerCase();

      // Duplicates are counted rather than stacked: the tenth agent to ask the
      // same thing is a signal about what the profile should say, not a tenth
      // item in a queue.
      const existingSnap = await faq.get();
      const existing = existingSnap.docs.find(
        (d) => (d.data().question as string).trim().toLowerCase() === normalised,
      );
      if (existing) {
        await existing.ref.set({ askedCount: FieldValue.increment(1) }, { merge: true });
        const updated = await existing.ref.get();
        return { ...(updated.data() as AgentFaqEntry), id: updated.id };
      }

      const entry: AgentFaqEntry = {
        id: makeId('faq'),
        agentId: targetAgentId,
        question,
        status: 'pending',
        askedAt: new Date().toISOString(),
        provenance: { mode: 'autonomous' },
        askedCount: 1,
      };
      await faq.doc(entry.id).set(clean(entry));

      await db()
        .collection(C.notifications)
        .doc(makeId('ntf'))
        .set(
          clean({
            agentId: targetAgentId,
            type: 'question_asked',
            createdAt: entry.askedAt,
            read: false,
            actor: asker ? { type: 'agent', id: asker.agentId } : undefined,
            actorName: asker?.agentName ?? 'Someone',
            faqEntryId: entry.id,
            content: { untrusted: true, excerpt: question.slice(0, 400) },
          }),
        );

      return entry;
    },
    async resolveFaqEntry(id, resolution) {
      const snap = await db().collectionGroup(C.faq).where('id', '==', id).limit(1).get();
      if (snap.empty) return;
      await snap.docs[0].ref.set(
        clean({ status: resolution.status, answer: resolution.answer, answeredAt: resolution.at }),
        { merge: true },
      );
    },

    // -- Keeping the record true -------------------------------------------
    async findCaveatRecord(eventId) {
      return readOne<CaveatRecord>(C.caveatRecords, eventId);
    },
    /**
     * Writes the record, plus a flat `confirmedBy` array beside it.
     *
     * Firestore cannot query a field inside an array of objects, so
     * `confirmations[].agentId` is unreachable — and "which caveats did this
     * agent confirm" is exactly the lookup the briefing needs. The flat array
     * is a storage detail rather than a domain concept, which is why it is
     * derived here on every write instead of being carried on `CaveatRecord`
     * where it could drift out of step with the list it summarises.
     */
    async saveCaveatRecord(record) {
      await db()
        .collection(C.caveatRecords)
        .doc(record.eventId)
        .set({
          ...clean(record),
          confirmedBy: record.confirmations.map((c) => c.agentId),
        });
    },

    /** The Q&A archive, checked before a question is broadcast to 25 agents. */
    async allFaqEntries() {
      const snap = await db()
        .collectionGroup(C.faq)
        .where('status', '==', 'answered')
        .limit(1000)
        .get();
      return snap.docs.map((d) => ({ ...(d.data() as AgentFaqEntry), id: d.id }));
    },
    async allOpenQuestions() {
      return readAll<OpenQuestion>(C.openQuestions);
    },

    // -- Briefing ------------------------------------------------------------
    // All bounded by `since` or by agent. A briefing must never cost what the
    // feed used to.
    async eventsSince(sinceIso, limit) {
      const snap = await db()
        .collection(C.events)
        .where('createdAt', '>', sinceIso)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();
      return snap.docs.map((d) => ({ ...(d.data() as FeedEvent), id: d.id }));
    },
    async openQuestionsSince(sinceIso, limit) {
      const snap = await db()
        .collection(C.openQuestions)
        .where('createdAt', '>', sinceIso)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();
      return snap.docs.map((d) => ({ ...(d.data() as OpenQuestion), id: d.id }));
    },
    async caveatSubjectsFiledBy(agentId) {
      const records = await readWhere<CaveatRecord>(C.caveatRecords, 'authorAgentId', agentId);
      return records.map((r) => r.subject);
    },
    /**
     * Subjects this agent confirmed.
     *
     * `confirmations` is an array of objects, which Firestore cannot query on a
     * nested field — so a parallel `confirmedBy` array of ids is maintained
     * beside it purely to make this one indexed lookup instead of a scan.
     */
    async caveatSubjectsConfirmedBy(agentId) {
      const snap = await db()
        .collection(C.caveatRecords)
        .where('confirmedBy', 'array-contains', agentId)
        .limit(200)
        .get();
      return snap.docs.map((d) => (d.data() as CaveatRecord).subject);
    },
    async threadSubjectsFor(agentId) {
      const snap = await db()
        .collection(C.threads)
        .where('contributorAgentIds', 'array-contains', agentId)
        .limit(200)
        .get();
      const threads = snap.docs.map((d) => d.data() as Thread);
      return threads.map((t) => `${t.slug} ${t.title}`);
    },
    async questionsAskedBy(agentId) {
      const questions = await readWhere<OpenQuestion>(
        C.openQuestions,
        'askedByAgentId',
        agentId,
        100,
      );
      return questions.map((q) => q.question);
    },
    async jobsFor(agentId) {
      const snap = await db()
        .collection(C.agents)
        .doc(agentId)
        .collection(C.jobs)
        .orderBy('completedAt', 'desc')
        .limit(200)
        .get();
      return snap.docs.map((d) => ({ ...(d.data() as ReportedJob), id: d.id }));
    },

    // -- Tags and matching ---------------------------------------------------

    /**
     * Tag document frequency, held in one document.
     *
     * A single read rather than a count over the corpus, which is the only
     * shape that works: match specificity is needed on every `/similar` call
     * and on every tagged post, and computing it by counting would make the
     * cheapest useful feature on the network one of the most expensive.
     */
    async tagStats() {
      const doc = await db().collection(C.tagStats).doc('global').get();
      const data = doc.data() ?? {};
      return {
        documentFrequency: (data.documentFrequency as Record<string, number>) ?? {},
        corpusSize: (data.corpusSize as number) ?? 0,
      };
    },
    /**
     * Bumps each tag's document frequency.
     *
     * Written as a **nested map**, not as dotted top-level keys — and the
     * difference is not cosmetic. `set()` treats its keys as literal field
     * names, so `{ 'documentFrequency.node.js': increment }` creates a
     * top-level field whose *name contains dots* rather than a counter inside
     * `documentFrequency`. `tagStats()` then reads `data.documentFrequency`,
     * finds nothing, and every tag looks maximally rare forever — which
     * silently inverts the entire matcher, since rarity is the whole signal.
     *
     * It typechecked, it passed against the mock (a plain object), and it was
     * only ever going to surface against a real database. `merge: true` deep-
     * merges maps, so the nested form accumulates correctly and dots in tag
     * names — `node.js`, `2.4.1` — need no escaping at all.
     */
    async recordTags(eventId, tags) {
      const documentFrequency: Record<string, unknown> = {};
      for (const tag of tags) documentFrequency[tag] = FieldValue.increment(1);

      await db()
        .collection(C.tagStats)
        .doc('global')
        .set({ corpusSize: FieldValue.increment(1), documentFrequency }, { merge: true });
      await db().collection(C.events).doc(eventId).set({ tagIndex: tags }, { merge: true });
    },
    /**
     * Posts carrying any of these tags.
     *
     * `array-contains-any` caps at 30 values, so the most distinctive tags go
     * first — they are the ones that actually discriminate, and truncating the
     * generic tail costs nothing.
     */
    async eventsByAnyTag(tags, limit) {
      if (!tags.length) return [];
      const snap = await db()
        .collection(C.events)
        .where('tagIndex', 'array-contains-any', tags.slice(0, 30))
        .limit(limit)
        .get();
      return snap.docs.map((d) => ({ ...(d.data() as FeedEvent), id: d.id }));
    },
    async recordMatchOffer(offer) {
      await db().collection(C.matchOffers).doc(offer.token).set(clean(offer));
    },
    async resolveMatchOffer(token, outcome) {
      await db()
        .collection(C.matchOffers)
        .doc(token)
        .set(clean({ resolvedAt: outcome.at, joinedThreadId: outcome.joinedThreadId }), {
          merge: true,
        });
    },

    // -- Threads -------------------------------------------------------------
    async findThread(id) {
      return readOne<Thread>(C.threads, id);
    },
    async allThreads() {
      return readAll<Thread>(C.threads);
    },
    async threadsBySlug(slug) {
      return readWhere<Thread>(C.threads, 'slug', slug);
    },
    async saveThread(thread) {
      await db().collection(C.threads).doc(thread.id).set(clean(thread));
    },
    async postsInThread(threadId) {
      return readWhere<FeedEvent>(C.events, 'thread.threadId', threadId);
    },

    // -- Standing subscriptions ---------------------------------------------
    async saveSubscription(subscription) {
      await db().collection(C.subscriptions).doc(subscription.id).set(clean(subscription));
    },
    async findSubscription(id) {
      return readOne<Subscription>(C.subscriptions, id);
    },
    async subscriptionsFor(agentId) {
      return readWhere<Subscription>(C.subscriptions, 'agentId', agentId);
    },
    async activeSubscriptions() {
      return readWhere<Subscription>(C.subscriptions, 'active', true);
    },
    async deleteSubscription(id) {
      await db().collection(C.subscriptions).doc(id).delete();
    },

    // -- Proving something is running ---------------------------------------
    async saveChallenge(challenge) {
      await db().collection(C.challenges).doc(challenge.id).set(clean(challenge));
    },
    async findChallenge(id) {
      return readOne<RuntimeChallenge>(C.challenges, id);
    },
    async passedChallengesFor(agentId) {
      const snap = await db()
        .collection(C.challenges)
        .where('agentId', '==', agentId)
        .where('passed', '==', true)
        .get();
      return snap.docs
        .map((d) => d.data().respondedAt as string)
        .filter(Boolean)
        .sort();
    },
    async webhookSecretFor(agentId) {
      const doc = await db().collection(C.secrets).doc(agentId).get();
      return doc.exists ? (doc.data()!.webhookSecret as string) : undefined;
    },

    /**
     * Everything this agent did, for cadence conformance.
     *
     * Bounded at 200 of each: the check needs a *pattern*, and reading an
     * agent's entire history to compute a coefficient of variation would make
     * liveness the most expensive call on the network.
     */
    async activityFor(agentId) {
      const [events, jobs, votes] = await Promise.all([
        db().collection(C.events).where('authorId', '==', agentId).orderBy('createdAt', 'desc').limit(200).get(),
        db().collection(C.agents).doc(agentId).collection(C.jobs).orderBy('reportedAt', 'desc').limit(200).get(),
        db().collection(C.pollVotes).where('agentId', '==', agentId).limit(200).get(),
      ]);
      return [
        ...events.docs.map((d) => d.data().createdAt as string),
        ...jobs.docs.map((d) => d.data().reportedAt as string),
        ...votes.docs.map((d) => d.data().createdAt as string),
      ]
        .filter(Boolean)
        .sort();
    },

    async setTrustTier(agentId, tier, method) {
      await db()
        .collection(C.agents)
        .doc(agentId)
        .set({ trustTier: tier, promotedBy: method, promotedAt: new Date().toISOString() }, { merge: true });
      return (await readOne<Agent>(C.agents, agentId))!;
    },

    nextId: makeId,
    now: () => new Date(),
  };
}

/** The read side. Same data, no write access — kept separate so that is obvious. */
export function createReadStore(): ReadStore {
  return {
    /**
     * One page of the feed, paged in Firestore.
     *
     * This is where the cost problem actually lived. The old shape read the
     * newest 500 events on every request and sliced an array, so one page of
     * 25 posts billed 500 document reads, the bill scaled with the network
     * rather than with traffic, and paging silently stopped at 500 because the
     * cursor was searching inside that fetched array.
     *
     * Now: `where` in the query, `orderBy` in the query, `startAfter` on a real
     * cursor, `limit(n + 1)`. A page of 25 costs 26 reads whether the network
     * holds a thousand posts or ten million.
     */
    async pageEvents(query) {
      const direction = query.sort === 'oldest' ? 'asc' : 'desc';
      let q = db().collection(C.events) as FirebaseFirestore.Query;

      // `in` caps at 30 values. Beyond that the filter is dropped and applied
      // after the fetch — correct, just less efficient, and vanishingly rare.
      if (query.types?.length && query.types.length <= 30) {
        q = q.where('type', 'in', query.types);
      }
      if (query.authorId) q = q.where('authorId', '==', query.authorId);
      // Server-side, so an agent polling a quiet network transfers nothing and
      // is billed for nothing.
      if (query.since) q = q.where('createdAt', '>', query.since);

      // Every sort ends on createdAt/id so ordering is total and a cursor
      // always names exactly one position.
      if (query.sort === 'most_liked') q = q.orderBy('engagement.likes', 'desc');
      else if (query.sort === 'most_discussed') q = q.orderBy('engagement.comments', 'desc');
      q = q.orderBy('createdAt', direction).orderBy('__name__', direction);

      const after = decodeCursor(query.cursor);
      if (after) {
        const anchor = await db().collection(C.events).doc(after.id).get();
        if (anchor.exists) q = q.startAfter(anchor);
      }

      // One extra document is how we know there is a next page without a
      // second query or a count.
      const snap = await q.limit(query.limit + 1).get();
      let events = snap.docs.map((d) => ({ ...(d.data() as FeedEvent), id: d.id }));

      if (query.types?.length && query.types.length > 30) {
        events = events.filter((e) => query.types!.includes(e.type));
      }

      const hasMore = events.length > query.limit;
      const page = hasMore ? events.slice(0, query.limit) : events;
      const last = page[page.length - 1];

      // For a newest-first page the head *is* the newest, so `latestAt` costs
      // nothing. Any other ordering needs one document to find it.
      let latestAt = query.sort === 'newest' ? page[0]?.createdAt : undefined;
      if (!latestAt && !query.cursor) {
        const newest = await db()
          .collection(C.events)
          .orderBy('createdAt', 'desc')
          .limit(1)
          .get();
        latestAt = newest.docs[0]?.data().createdAt as string | undefined;
      }

      return { events: page, nextCursor: hasMore && last ? encodeCursor(last) : undefined, latestAt };
    },

    async recentEvents(limit) {
      const snap = await db()
        .collection(C.events)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();
      return snap.docs.map((d) => ({ ...(d.data() as FeedEvent), id: d.id }));
    },
    async findEvent(eventId) {
      return readOne<FeedEvent>(C.events, eventId);
    },
    async postsInThread(threadId) {
      return readWhere<FeedEvent>(C.events, 'thread.threadId', threadId);
    },
    async threadsBySlug(slug) {
      return readWhere<Thread>(C.threads, 'slug', slug);
    },
    async allAgents() {
      return readAll<Agent>(C.agents);
    },

    /**
     * Only the accounts a page actually references.
     *
     * `getAll` fetches exactly these documents in one round trip and bills one
     * read each — where the previous `accountsById()` read every agent, builder
     * and studio on the network to resolve the two dozen a page mentions.
     */
    async accountsFor(ids) {
      const unique = [...new Set(ids)].filter(Boolean);
      if (!unique.length) return {};

      const database = db();
      const refs = unique.flatMap((id) => [
        database.collection(C.agents).doc(id),
        database.collection(C.builders).doc(id),
        database.collection(C.studios).doc(id),
      ]);

      const out: Record<string, Account> = {};
      // Chunked: `getAll` is generous but not unbounded, and a page can name
      // more accounts than one call should carry.
      for (let i = 0; i < refs.length; i += 300) {
        const docs = await database.getAll(...refs.slice(i, i + 300));
        for (const doc of docs) {
          if (doc.exists) out[doc.id] = { ...(doc.data() as Account), id: doc.id };
        }
      }
      return out;
    },
    async operatorsById() {
      const [builders, studios] = await Promise.all([
        readAll<Builder>(C.builders),
        readAll<Studio>(C.studios),
      ]);
      const out: Record<string, Builder | Studio> = {};
      for (const op of [...builders, ...studios]) out[op.id] = op;
      return out;
    },
    async relationshipsFor(agentId) {
      return readWhere<AgentRelationship>(C.relationships, 'agentId', agentId);
    },
    async commentsFor(eventId) {
      const snap = await db()
        .collection(C.events)
        .doc(eventId)
        .collection(C.comments)
        .orderBy('createdAt', 'asc')
        .limit(500)
        .get();
      return snap.docs.map((d) => ({ ...(d.data() as Comment), id: d.id }));
    },
    // `commentCounts()` is gone. It read every event in the network — a
    // `select()` projection still bills a full document read — to rebuild a
    // number `appendComment` already increments atomically on the event.
    async jobsFor(agentId) {
      const snap = await db()
        .collection(C.agents)
        .doc(agentId)
        .collection(C.jobs)
        .orderBy('completedAt', 'desc')
        .limit(500)
        .get();
      return snap.docs.map((d) => ({ ...(d.data() as ReportedJob), id: d.id }));
    },
    async attestationsFor(agentId) {
      return readWhere<Attestation>(C.attestations, 'subjectAgentId', agentId);
    },
    async faqFor(agentId) {
      const snap = await db().collection(C.agents).doc(agentId).collection(C.faq).get();
      return snap.docs.map((d) => ({ ...(d.data() as AgentFaqEntry), id: d.id }));
    },
    async connectionsFor(agentId) {
      const [followerSnap, followingSnap, agents] = await Promise.all([
        db().collection(C.connections).where('followingId', '==', agentId).limit(500).get(),
        db().collection(C.connections).where('followerId', '==', agentId).limit(500).get(),
        readAll<Agent>(C.agents),
      ]);
      const byId = new Map(agents.map((a) => [a.id, a]));
      const resolve = (ids: string[]) => ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
      return {
        followers: resolve(followerSnap.docs.map((d) => d.data().followerId as string)),
        following: resolve(followingSnap.docs.map((d) => d.data().followingId as string)),
      };
    },
    async findPoll(id) {
      return readOne<Poll>(C.polls, id);
    },
    async pollVotes(pollId) {
      return readWhere<PollVote>(C.pollVotes, 'pollId', pollId);
    },
    async findAgentByRef(ref) {
      const [byTag] = await readWhere<Agent>(C.agents, 'tag', ref, 1);
      if (byTag) return byTag;
      const [byHandle] = await readWhere<Agent>(C.agents, 'handle', ref.replace(/^@/, '').toLowerCase(), 1);
      if (byHandle) return byHandle;
      const byId = await readOne<Agent>(C.agents, ref);
      if (byId) return byId;
      const all = await readAll<Agent>(C.agents);
      return all.find((a) => matchesRef(a, ref));
    },
    async allCaveatRecords() {
      return readAll<CaveatRecord>(C.caveatRecords);
    },
    async allThreads() {
      return readAll<Thread>(C.threads);
    },
    /**
     * Every answered Q&A entry, across all agents.
     *
     * Filtered to `answered` in the query rather than in memory: a pending
     * question is private until its agent replies, and reading them all back
     * only to discard them would put unanswered questions on the wire.
     */
    async allFaqEntries() {
      const snap = await db()
        .collectionGroup(C.faq)
        .where('status', '==', 'answered')
        .limit(1000)
        .get();
      return snap.docs.map((d) => ({ ...(d.data() as AgentFaqEntry), id: d.id }));
    },
    async allOpenQuestions() {
      return readAll<OpenQuestion>(C.openQuestions);
    },
    now: () => new Date(),
  };
}
