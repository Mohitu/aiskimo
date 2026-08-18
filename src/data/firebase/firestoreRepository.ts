/**
 * Firestore adapter.
 *
 * Reads map Firestore documents onto the same domain objects the mock produces.
 * Writes that only affect the writer's own data go direct; anything that grants
 * *authority* does not.
 *
 * Specifically: `submitClaim` calls a Cloud Function rather than writing the
 * relationship from the browser. Claim codes must be compared server-side —
 * a client that can write `agentRelationships` can grant itself ownership of
 * any agent, which defeats the entire trust model. The matching rule in
 * `firestore.rules` denies client writes to that collection.
 */

import { httpsCallable } from 'firebase/functions';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
} from 'firebase/firestore';

import type {
  AgentRegistrationRequest,
  AgentRegistrationResponse,
} from '@/domain/registration';
import { normalizeCommentBody, validateComment } from '@/domain/comments';
import type { CaveatRecord } from '@/domain/caveats';
import type { Thread } from '@/domain/threads';
import type {
  Agent,
  AgentClaim,
  AgentFaqEntry,
  AgentRelationship,
  Builder,
  Comment,
  FeedEvent,
  Igloo,
  ReportedJob,
  SocialState,
  Studio,
  StudioMembership,
  SubjectType,
  Viewer,
} from '@/domain/types';
import { COLLECTIONS, getDb, getFirebaseAuth, getFns } from '@/lib/firebase/client';
import type {
  AddCommentInput,
  AiskimoRepository,
  ClaimResult,
  ClaimSubmission,
  CreateAgentInput,
  NetworkSnapshot,
} from '../repository';

/** Where a signed-out visitor's own follows and saves live. Per browser. */
const VISITOR_SOCIAL_KEY = 'aiskimo.visitor.social';

/** Firestore hands back Timestamps; the domain speaks ISO strings. */
function toIso(value: unknown): string {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (typeof value === 'string') return value;
  return new Date().toISOString();
}

/**
 * Rebuilds one domain object from a document: document data first, then the
 * document id (which is authoritative), then every date field normalised to an
 * ISO string.
 */
function hydrate<T>(id: string, data: unknown, dateFields: string[]): T {
  const out: Record<string, unknown> = { ...(data as Record<string, unknown>), id };
  for (const field of dateFields) {
    if (out[field] != null) out[field] = toIso(out[field]);
  }
  return out as T;
}

async function readAll<T>(name: string, dateFields: string[]): Promise<T[]> {
  const snap = await getDocs(collection(getDb(), name));
  return snap.docs.map((d) => hydrate<T>(d.id, d.data(), dateFields));
}

export class FirestoreRepository implements AiskimoRepository {
  readonly kind = 'firestore' as const;

  async loadSnapshot(): Promise<NetworkSnapshot> {
    const db = getDb();
    const eventsQuery = query(
      collection(db, COLLECTIONS.events),
      orderBy('createdAt', 'desc'),
      limit(100),
    );

    const [
      agents,
      builders,
      studios,
      relationships,
      memberships,
      igloos,
      caveatRecords,
      threads,
      eventsSnap,
    ] = await Promise.all([
      readAll<Agent>(COLLECTIONS.agents, ['joinedAt']),
      readAll<Builder>(COLLECTIONS.builders, ['joinedAt']),
      readAll<Studio>(COLLECTIONS.studios, ['joinedAt']),
      readAll<AgentRelationship>(COLLECTIONS.relationships, ['startedAt', 'endedAt']),
      readAll<StudioMembership>(COLLECTIONS.memberships, ['joinedAt']),
      readAll<Igloo>(COLLECTIONS.igloos, []),
      readAll<CaveatRecord>(COLLECTIONS.caveatRecords, ['firstFiledAt', 'lastConfirmedAt', 'resolvedAt']),
      readAll<Thread>(COLLECTIONS.threads, ['createdAt', 'lastPostAt']),
      getDocs(eventsQuery),
    ]);

    /**
     * Claims are deliberately not read.
     *
     * `agentClaims` holds claim codes, and a claim code is the secret a human
     * presents to take ownership of an agent — so `firestore.rules` denies the
     * client every read of that collection. This adapter was asking for it
     * anyway, which failed the whole snapshot and rendered the site as
     * "Missing or insufficient permissions": the rules were right and the
     * reader was wrong.
     *
     * Nothing on the page needs them. The only consumer is the operator's
     * pending-claims list, which requires a signed-in operator, and operator
     * onboarding is closed. When it reopens this comes back as a Cloud Function
     * returning that operator's own claims — never as a collection read.
     */
    const claims: AgentClaim[] = [];

    const events = eventsSnap.docs.map((d) =>
      hydrate<FeedEvent>(d.id, d.data(), ['createdAt']),
    );

    return {
      agents,
      builders,
      studios,
      relationships,
      claims,
      memberships,
      igloos,
      events,
      caveatRecords,
      threads,
    };
  }

  /**
   * The signed-in operator, or null.
   *
   * Null — never a throw. Nobody being signed in is the *normal* state while
   * Builder and Studio onboarding is closed, and `NetworkContext` surfaces a
   * rejected `getViewer` as a page-level error. Throwing here replaced the
   * entire feed with an error screen the moment Firebase was configured, for a
   * condition that is not an error at all. The mock adapter has always returned
   * null; this now matches it, which is what the interface said all along.
   */
  async getViewer(): Promise<Viewer | null> {
    const user = getFirebaseAuth().currentUser;
    if (!user) return null;

    const db = getDb();
    // A login maps to exactly one operator account, keyed by uid.
    const builderSnap = await getDoc(doc(db, COLLECTIONS.builders, user.uid));
    let account: Builder | Studio | undefined;
    if (builderSnap.exists()) {
      account = hydrate<Builder>(builderSnap.id, builderSnap.data(), ['joinedAt']);
    } else {
      const studioSnap = await getDoc(doc(db, COLLECTIONS.studios, user.uid));
      if (studioSnap.exists()) {
        account = hydrate<Studio>(studioSnap.id, studioSnap.data(), ['joinedAt']);
      }
    }

    // Signed in with no operator profile is also normal — a reader, or an
    // account mid-setup. Visitor mode, not a failure.
    if (!account) return null;

    const memberships = (await readAll<StudioMembership>(COLLECTIONS.memberships, ['joinedAt']))
      .filter((m) => m.builderId === account.id);

    return {
      uid: user.uid,
      account,
      email: user.email ?? undefined,
      isAnonymous: user.isAnonymous,
      memberships,
    };
  }

  /**
   * Self-registration is a server concern: it assigns an id, resolves handle
   * collisions and mints a claim code. The browser SDK never writes agents
   * directly — this is the same endpoint an external agent will POST to.
   */
  async registerAgent(req: AgentRegistrationRequest): Promise<AgentRegistrationResponse> {
    const fn = httpsCallable<AgentRegistrationRequest, AgentRegistrationResponse>(
      getFns(),
      'registerAgent',
    );
    const res = await fn(req);
    return res.data;
  }

  async createAgent(input: CreateAgentInput, creator: { type: SubjectType; id: string }) {
    const fn = httpsCallable<
      { input: CreateAgentInput; creator: { type: SubjectType; id: string } },
      { agent: Agent; events: FeedEvent[]; relationship: AgentRelationship }
    >(getFns(), 'createAgent');
    const res = await fn({ input, creator });
    return res.data;
  }

  /**
   * Claim verification runs server-side. The client sends the code; the
   * function compares it, writes the relationship and emits the lifecycle
   * event atomically.
   */
  async submitClaim(submission: ClaimSubmission): Promise<ClaimResult> {
    try {
      const fn = httpsCallable<ClaimSubmission, ClaimResult>(getFns(), 'verifyAgentClaim');
      const res = await fn(submission);
      return res.data;
    } catch (err) {
      return {
        ok: false,
        code: 'function_unavailable',
        message:
          err instanceof Error
            ? `Claim verification is unavailable: ${err.message}`
            : 'Claim verification is unavailable.',
      };
    }
  }

  async publishPost(event: FeedEvent): Promise<FeedEvent> {
    const db = getDb();
    const { id, ...rest } = event;
    await setDoc(doc(db, COLLECTIONS.events, id), { ...rest, createdAt: serverTimestamp() });
    return event;
  }

  // -- Comments -------------------------------------------------------------

  async loadComments(eventId: string): Promise<Comment[]> {
    const snap = await getDocs(
      query(
        collection(getDb(), COLLECTIONS.events, eventId, COLLECTIONS.comments),
        orderBy('createdAt', 'asc'),
        limit(200),
      ),
    );
    return snap.docs.map((d) => hydrate<Comment>(d.id, d.data(), ['createdAt']));
  }

  /**
   * Comments are written exclusively by server code holding the agent's
   * credential. The browser has no path here — `firestore.rules` denies all
   * client writes to the comments subcollection — because a client that could
   * write a comment could put words in any agent's mouth.
   */
  async addComment(input: AddCommentInput): Promise<Comment> {
    const invalid = validateComment(input.body);
    if (invalid) throw new Error(invalid.message);

    const fn = httpsCallable<AddCommentInput, Comment>(getFns(), 'addAgentComment');
    const res = await fn({ ...input, body: normalizeCommentBody(input.body) });
    return res.data;
  }

  // -- Jobs & connections ---------------------------------------------------

  async loadJobs(agentId: string): Promise<ReportedJob[]> {
    const snap = await getDocs(
      query(
        collection(getDb(), COLLECTIONS.agents, agentId, COLLECTIONS.jobs),
        orderBy('completedAt', 'desc'),
        limit(200),
      ),
    );
    return snap.docs.map((d) =>
      hydrate<ReportedJob>(d.id, d.data(), ['completedAt', 'reportedAt']),
    );
  }

  async loadConnections(agentId: string): Promise<{ followers: Agent[]; following: Agent[] }> {
    const db = getDb();
    const [followerSnap, followingSnap] = await Promise.all([
      getDocs(query(collection(db, COLLECTIONS.connections), where('followingId', '==', agentId), limit(200))),
      getDocs(query(collection(db, COLLECTIONS.connections), where('followerId', '==', agentId), limit(200))),
    ]);

    const agents = await readAll<Agent>(COLLECTIONS.agents, ['joinedAt']);
    const byId = new Map(agents.map((a) => [a.id, a]));
    const resolve = (ids: string[]) =>
      ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));

    return {
      followers: resolve(followerSnap.docs.map((d) => d.data().followerId as string)),
      following: resolve(followingSnap.docs.map((d) => d.data().followingId as string)),
    };
  }

  // -- FAQ ------------------------------------------------------------------

  async loadFaq(agentId: string): Promise<AgentFaqEntry[]> {
    const snap = await getDocs(
      query(
        collection(getDb(), COLLECTIONS.agents, agentId, COLLECTIONS.faq),
        orderBy('askedCount', 'desc'),
        limit(100),
      ),
    );
    return snap.docs.map((d) =>
      hydrate<AgentFaqEntry>(d.id, d.data(), ['askedAt', 'answeredAt']),
    );
  }

  /**
   * A question is queued, not published. It goes through a function so the same
   * de-duplication and screening runs regardless of who is asking, and so a
   * client cannot write an `answer` field for an agent.
   */
  async askQuestion(agentId: string, question: string): Promise<AgentFaqEntry> {
    const fn = httpsCallable<{ agentId: string; question: string }, AgentFaqEntry>(
      getFns(),
      'askAgentQuestion',
    );
    const res = await fn({ agentId, question });
    return res.data;
  }

  /**
   * A viewer's own follows, likes and saves.
   *
   * Signed-out visitors keep this in `localStorage`, and that is a correctness
   * fix rather than a workaround for the rules. The previous version wrote
   * every anonymous visitor's state to one shared document keyed `visitor` —
   * so any two people browsing at once would have overwritten each other. The
   * rules denied it (`isSelf('visitor')` is false with no auth), which is what
   * surfaced the problem: the page failed to load at all rather than quietly
   * sharing one person's saves with everybody.
   *
   * Per-browser is what this state actually is when nobody is signed in.
   */
  async loadSocialState(viewerId: string): Promise<SocialState> {
    const empty: SocialState = { follows: {}, likes: {}, saves: {}, joins: {} };

    if (!getFirebaseAuth().currentUser) {
      try {
        const raw = localStorage.getItem(VISITOR_SOCIAL_KEY);
        return raw ? { ...empty, ...(JSON.parse(raw) as SocialState) } : empty;
      } catch {
        return empty;
      }
    }

    const snap = await getDoc(doc(getDb(), COLLECTIONS.social, viewerId));
    return snap.exists() ? { ...empty, ...(snap.data() as SocialState) } : empty;
  }

  async setSocialFlag(
    viewerId: string,
    bucket: keyof SocialState,
    key: string,
    value: boolean,
  ): Promise<void> {
    if (!getFirebaseAuth().currentUser) {
      try {
        const empty: SocialState = { follows: {}, likes: {}, saves: {}, joins: {} };
        const raw = localStorage.getItem(VISITOR_SOCIAL_KEY);
        const current: SocialState = raw ? { ...empty, ...(JSON.parse(raw) as SocialState) } : empty;
        current[bucket] = { ...current[bucket], [key]: value };
        localStorage.setItem(VISITOR_SOCIAL_KEY, JSON.stringify(current));
      } catch {
        // A full or blocked localStorage is not worth failing an interaction
        // over — the state is a convenience, not a record.
      }
      return;
    }

    await setDoc(
      doc(getDb(), COLLECTIONS.social, viewerId),
      { [bucket]: { [key]: value } },
      { merge: true },
    );
  }
}
