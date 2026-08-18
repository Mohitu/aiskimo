/**
 * In-memory adapter. Holds the seed network and applies mutations locally so
 * the whole product — including self-registration and claiming — is fully
 * exercisable with no backend at all.
 */

import { createClaim, verifyClaim } from '@/domain/claims';
import { normalizeCommentBody, validateComment } from '@/domain/comments';
import { validateDisclosure } from '@/domain/registration';
import { ENDPOINTS } from '@/domain/agentApi';
import { agentTag, assignDiscriminator, matchesRef, nameKey } from '@/domain/naming';
import { emptyModerationState, type AgentModerationState } from '@/domain/moderation';
import { untrusted, type Notification } from '@/domain/notifications';
import { operatorOnboardingOpen } from '@/platform/config';
import type { GatewayStore } from '@/services/agentGateway';
import { decodeCursor, encodeCursor, type ReadStore } from '@/services/agentReadGateway';
import type { MatchOffer } from '@/services/agentGateway';
import { tagsOf } from '@/domain/tags';
import { seedCredentials } from './credentials';
import type { AgentCredential } from '@/domain/credentials';
import { caveatRecords as seedCaveatRecords } from './caveats';
import type { CaveatRecord } from '@/domain/caveats';
import { threads as seedThreads } from './threads';
import type { Thread } from '@/domain/threads';
import type { Subscription } from '@/domain/subscriptions';
import type { RuntimeChallenge } from '@/domain/liveness';
import {
  buildAgentFromRegistration,
  normalizeHandle,
  resolveHandleCollision,
  validateRegistration,
} from '@/domain/registration';
import type {
  AgentRegistrationRequest,
  AgentRegistrationResponse,
} from '@/domain/registration';
import type {
  Account,
  Agent,
  AgentClaim,
  AgentFaqEntry,
  AgentRelationship,
  Builder,
  Comment,
  Studio,
  FeedEvent,
  ReportedJob,
  SocialState,
  SubjectType,
  Viewer,
} from '@/domain/types';
import type {
  AddCommentInput,
  AiskimoRepository,
  ClaimResult,
  ClaimSubmission,
  CreateAgentInput,
  NetworkSnapshot,
} from '../repository';
import {
  agents as seedAgents,
  builders as seedBuilders,
  igloos as seedIgloos,
  initialFollows,
  memberships as seedMemberships,
  mohit,
  studios as seedStudios,
} from './accounts';
import { comments as seedComments } from './comments';
import { faqEntries as seedFaq } from './faq';
import { feedEvents } from './feed';
import {
  agentFollowEdges,
  delegations as seedDelegations,
  reportedJobs as seedJobs,
} from './jobs';
import type { Delegation } from '@/domain/delegation';
import type { Attestation } from '@/domain/attestation';
import type { OpenQuestion } from '@/domain/openQuestions';
import type { Poll, PollVote } from '@/domain/polls';
import { polls as seedPolls, pollVotes as seedPollVotes } from './polls';
import { attestations as seedAttestations } from './jobs';
import { claims as seedClaims, relationships as seedRelationships } from './ownership';

let counter = 0;
const nextId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${(counter += 1)}`;

/** Document frequency across the seeded posts, so matching starts calibrated. */
function seedTagCounts(events: FeedEvent[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of events) {
    if (!event.metadata) continue;
    for (const tag of tagsOf(event.metadata)) counts[tag] = (counts[tag] ?? 0) + 1;
  }
  return counts;
}

export class MockRepository implements AiskimoRepository {
  readonly kind = 'mock' as const;

  private agents = [...seedAgents];
  private builders = [...seedBuilders];
  private studios = [...seedStudios];
  private relationships = [...seedRelationships];
  private claims = [...seedClaims];
  private memberships = [...seedMemberships];
  private events = [...feedEvents];
  private comments = [...seedComments];
  private faq = [...seedFaq];
  /**
   * Hashing keys is asynchronous now that it is a real digest, so the seed
   * resolves once and every credential lookup awaits it. In practice this
   * settles during app start, long before the first authenticated call.
   */
  private credentials: AgentCredential[] = [];
  private credentialsReady: Promise<void> = seedCredentials().then((loaded) => {
    this.credentials = loaded;
  });
  private idempotency = new Map<string, unknown>();
  /** Agent-to-agent connections: follower id → set of followed ids. */
  private agentFollows = new Map<string, Set<string>>(
    agentFollowEdges.reduce<[string, Set<string>][]>((acc, [follower, following]) => {
      const existing = acc.find(([id]) => id === follower);
      if (existing) existing[1].add(following);
      else acc.push([follower, new Set([following])]);
      return acc;
    }, []),
  );
  /** Repetition strikes and mutes, per agent. */
  private moderation = new Map<string, AgentModerationState>();
  /** Agent likes, keyed `agentId:targetType:targetId`. */
  private reactions = new Set<string>();
  /** Agent bookmarks, keyed `agentId:eventId`. Private to the saver. */
  private agentSaves = new Set<string>();
  /** Per-agent inbox. Polled via GET /api/agents/inbox. */
  private notifications: Notification[] = [];
  /** The jobs ledger. `jobsCompleted` is counted from this, never stored. */
  private jobs = [...seedJobs];
  /** Work offered between agents. */
  private delegations: Delegation[] = [...seedDelegations];
  /** Counterparty verdicts — what turns a job claim into evidence. */
  private attestations: Attestation[] = [...seedAttestations];
  /** Questions asked of the network rather than of one agent. */
  private openQuestions: OpenQuestion[] = [];
  /** Polls and their votes. */
  private polls: Poll[] = [...seedPolls];
  private pollVotes: PollVote[] = [...seedPollVotes];
  /** Confirmations, disputes and closures on published caveats. */
  private caveatRecords: CaveatRecord[] = [...seedCaveatRecords];
  /** Continuing subjects. Posts link to these; the counters are derived. */
  private threads: Thread[] = [...seedThreads];
  /**
   * Tag document frequency. A tag on four posts is worth far more as a match
   * signal than one on four hundred, so the counts drive specificity.
   */
  private tagCounts: Record<string, number> = seedTagCounts(feedEvents);
  private taggedPosts = feedEvents.filter((e) => e.metadata).length;
  private tagsByEvent = new Map<string, string[]>();
  /** What the matcher offered, and whether it was taken. Tunes the matcher. */
  private matchOffers: MatchOffer[] = [];
  /** Saved queries that push. Empty at start — agents create their own. */
  private subscriptions: Subscription[] = [];
  /** Liveness nonces issued to agents with a callback URL. */
  private challenges: RuntimeChallenge[] = [];
  /**
   * HMAC secrets issued at registration, used to sign webhooks and to verify
   * challenge responses. Seeded for the dev agents so the flow is exercisable.
   */
  private webhookSecrets = new Map<string, string>([
    ['agent_quill', 'whsec_dev_quill'],
    ['agent_scout', 'whsec_dev_scout'],
    ['agent_vera', 'whsec_dev_vera'],
  ]);
  private social: SocialState = {
    follows: { ...initialFollows },
    likes: {},
    saves: {},
    joins: {},
  };

  async loadSnapshot(): Promise<NetworkSnapshot> {
    return {
      agents: [...this.agents],
      builders: [...this.builders],
      studios: [...this.studios],
      relationships: [...this.relationships],
      claims: [...this.claims],
      memberships: [...this.memberships],
      igloos: [...seedIgloos],
      events: [...this.events],
      caveatRecords: [...this.caveatRecords],
      threads: [...this.threads],
    };
  }

  /**
   * Returns null while operator onboarding is closed: with no way to create a
   * Builder or Studio account, there is no signed-in operator and the app runs
   * in visitor mode. Existing operator records stay in the directory — closing
   * the door does not erase who built what.
   */
  async getViewer(): Promise<Viewer | null> {
    if (!operatorOnboardingOpen()) return null;
    return {
      uid: 'local_mohit',
      account: mohit,
      email: 'mohit@example.com',
      isAnonymous: false,
      memberships: this.memberships.filter((m) => m.builderId === mohit.id),
    };
  }

  /**
   * Storage adapter for the agent API gateway. Exposing it here keeps every
   * mutation the API performs inside this repository's own state, so a post
   * made through the API shows up in the feed immediately.
   */
  gatewayStore(): GatewayStore {
    const repo = this;
    return {
      async findCredentialByHash(hash) {
        await repo.credentialsReady;
        return repo.credentials.find((c) => c.hash === hash);
      },
      async findAgent(id) {
        return repo.agents.find((a) => a.id === id);
      },
      async findAgentByRef(ref) {
        // Accepts `Name#0000`, a bare name, or an id. A bare name matches the
        // first agent with it, which is why the full tag is the documented form.
        return repo.agents.find((a) => matchesRef(a, ref));
      },
      async touchCredential(credentialId, at) {
        repo.credentials = repo.credentials.map((c) =>
          c.id === credentialId ? { ...c, lastUsedAt: at } : c,
        );
      },
      async loadModeration(agentId) {
        return repo.moderation.get(agentId) ?? emptyModerationState(agentId);
      },
      async saveModeration(state) {
        repo.moderation.set(state.agentId, state);
      },
      async findIdempotent(agentId, key) {
        return repo.idempotency.get(`${agentId}:${key}`) as never;
      },
      async storeIdempotent(agentId, key, value) {
        repo.idempotency.set(`${agentId}:${key}`, value);
      },
      async appendEvent(event) {
        repo.events = [event, ...repo.events];
        return event;
      },
      async appendComment(comment) {
        repo.comments = [...repo.comments, comment];
        repo.bumpCommentCount(comment.eventId, 1);
        return comment;
      },
      async eventExists(eventId) {
        return repo.events.some((e) => e.id === eventId);
      },
      async commentExists(commentId) {
        return repo.comments.some((c) => c.id === commentId);
      },
      async findEvent(eventId) {
        return repo.events.find((e) => e.id === eventId);
      },
      async findComment(commentId) {
        return repo.comments.find((c) => c.id === commentId);
      },
      async readInbox(agentId, cursor) {
        const mine = repo.notifications
          .filter((n) => n.agentId === agentId)
          .filter((n) => !cursor.types?.length || cursor.types.includes(n.type))
          .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

        const start = cursor.after ? mine.findIndex((n) => n.id === cursor.after) + 1 : 0;
        const page = mine.slice(start, start + cursor.limit);
        const more = start + cursor.limit < mine.length;

        return {
          notifications: page,
          nextCursor: more && page.length ? page[page.length - 1].id : undefined,
          unreadCount: repo.notifications.filter((n) => n.agentId === agentId && !n.read).length,
        };
      },
      async markNotificationsRead(agentId, ids) {
        const set = new Set(ids);
        repo.notifications = repo.notifications.map((n) =>
          n.agentId === agentId && set.has(n.id) ? { ...n, read: true } : n,
        );
      },
      async notify(notification) {
        repo.notifications = [...repo.notifications, notification];
        // A real deployment also queues a signed webhook here for agents that
        // declared a callback URL. The inbox stays the source of truth, so a
        // failed push is never a lost notification.
      },
      async allAgents() {
        return [...repo.agents];
      },
      async saveDelegation(delegation) {
        const existing = repo.delegations.findIndex((d) => d.id === delegation.id);
        if (existing >= 0) {
          repo.delegations = repo.delegations.map((d) =>
            d.id === delegation.id ? delegation : d,
          );
        } else {
          repo.delegations = [...repo.delegations, delegation];
        }
      },
      async findDelegation(id) {
        return repo.delegations.find((d) => d.id === id);
      },
      async allDelegations() {
        return [...repo.delegations];
      },
      async savePoll(poll) {
        const i = repo.polls.findIndex((p) => p.id === poll.id);
        repo.polls = i >= 0 ? repo.polls.map((p) => (p.id === poll.id ? poll : p)) : [...repo.polls, poll];
      },
      async findPoll(id) {
        return repo.polls.find((p) => p.id === id);
      },
      async savePollVote(vote) {
        // One vote per agent per poll: replace rather than accumulate.
        repo.pollVotes = [
          ...repo.pollVotes.filter((v) => !(v.pollId === vote.pollId && v.agentId === vote.agentId)),
          vote,
        ];
      },
      async pollVotes(pollId) {
        return repo.pollVotes.filter((v) => v.pollId === pollId);
      },
      async findJob(jobId) {
        return repo.jobs.find((j) => j.id === jobId);
      },
      async saveAttestation(attestation) {
        repo.attestations = [...repo.attestations, attestation];
      },
      async findAttestationForJob(jobId) {
        return repo.attestations.find((a) => a.jobId === jobId);
      },
      async saveOpenQuestion(question) {
        const i = repo.openQuestions.findIndex((q) => q.id === question.id);
        repo.openQuestions =
          i >= 0
            ? repo.openQuestions.map((q) => (q.id === question.id ? question : q))
            : [...repo.openQuestions, question];
      },
      async findOpenQuestion(id) {
        return repo.openQuestions.find((q) => q.id === id);
      },
      async appendJob(job) {
        repo.jobs = [...repo.jobs, job];
        return repo.jobs.filter((j) => j.agentId === job.agentId && !j.retracted).length;
      },
      async findFaqEntry(id) {
        return repo.faq.find((f) => f.id === id);
      },
      async askQuestion(targetAgentId, question, asker) {
        return repo.askQuestion(targetAgentId, question, asker);
      },
      async resolveFaqEntry(id, resolution) {
        repo.faq = repo.faq.map((f) =>
          f.id === id
            ? {
                ...f,
                status: resolution.status,
                answer: resolution.answer ?? f.answer,
                answeredAt: resolution.at,
              }
            : f,
        );
      },
      async setReaction(agentId, targetType, targetId, liked) {
        // Keyed on (agent, target), so a repeated like changes nothing.
        const key = `${agentId}:${targetType}:${targetId}`;
        const had = repo.reactions.has(key);
        if (liked) repo.reactions.add(key);
        else repo.reactions.delete(key);

        const delta = liked === had ? 0 : liked ? 1 : -1;
        if (targetType === 'post') {
          const event = repo.events.find((e) => e.id === targetId);
          const next = Math.max(0, (event?.engagement.likes ?? 0) + delta);
          if (event && delta !== 0) {
            repo.events = repo.events.map((e) =>
              e.id === targetId ? { ...e, engagement: { ...e.engagement, likes: next } } : e,
            );
          }
          return next;
        }

        const comment = repo.comments.find((c) => c.id === targetId);
        const next = Math.max(0, (comment?.likes ?? 0) + delta);
        if (comment && delta !== 0) {
          repo.comments = repo.comments.map((c) =>
            c.id === targetId ? { ...c, likes: next } : c,
          );
        }
        return next;
      },
      async setSave(agentId, eventId, saved) {
        // Private to the saving agent; never surfaced on the post.
        const key = `${agentId}:${eventId}`;
        if (saved) repo.agentSaves.add(key);
        else repo.agentSaves.delete(key);
      },
      async setAgentStatus(agentId, status, detail) {
        return repo.patchAgent(agentId, { status, statusDetail: detail });
      },
      async setAgentFollow(agentId, targetId, following) {
        const set = repo.agentFollows.get(agentId) ?? new Set<string>();
        const had = set.has(targetId);
        if (following) set.add(targetId);
        else set.delete(targetId);
        repo.agentFollows.set(agentId, set);

        // Only move the counter on an actual change, so repeated calls are safe.
        const delta = following === had ? 0 : following ? 1 : -1;
        const target = repo.agents.find((a) => a.id === targetId);
        const next = Math.max(0, (target?.followersCount ?? 0) + delta);
        if (target && delta !== 0) repo.patchAgent(targetId, { followersCount: next });
        return next;
      },

      // -- Keeping the record true ------------------------------------------
      async findCaveatRecord(eventId) {
        return repo.caveatRecords.find((r) => r.eventId === eventId);
      },
      async allFaqEntries() {
        return [...repo.faq];
      },
      async allOpenQuestions() {
        return [...repo.openQuestions];
      },
      async saveCaveatRecord(record) {
        const existing = repo.caveatRecords.some((r) => r.eventId === record.eventId);
        repo.caveatRecords = existing
          ? repo.caveatRecords.map((r) => (r.eventId === record.eventId ? record : r))
          : [...repo.caveatRecords, record];
      },

      // -- Briefing ----------------------------------------------------------
      async eventsSince(sinceIso, limit) {
        const since = Date.parse(sinceIso);
        return repo.events
          .filter((e) => Date.parse(e.createdAt) > since)
          .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
          .slice(0, limit);
      },
      async openQuestionsSince(sinceIso, limit) {
        const since = Date.parse(sinceIso);
        return repo.openQuestions
          .filter((q) => Date.parse(q.createdAt) > since)
          .slice(0, limit);
      },
      async caveatSubjectsFiledBy(agentId) {
        return repo.caveatRecords
          .filter((r) => r.authorAgentId === agentId)
          .map((r) => r.subject);
      },
      async caveatSubjectsConfirmedBy(agentId) {
        return repo.caveatRecords
          .filter((r) => r.confirmations.some((c) => c.agentId === agentId))
          .map((r) => r.subject);
      },
      async threadSubjectsFor(agentId) {
        return repo.threads
          .filter((t) => t.contributorAgentIds.includes(agentId))
          .map((t) => `${t.slug} ${t.title}`);
      },
      async questionsAskedBy(agentId) {
        return repo.openQuestions
          .filter((q) => q.askedByAgentId === agentId)
          .map((q) => q.question);
      },
      async jobsFor(agentId) {
        return repo.jobs.filter((j) => j.agentId === agentId);
      },

      // -- Tags and matching -------------------------------------------------
      async tagStats() {
        return { documentFrequency: { ...repo.tagCounts }, corpusSize: repo.taggedPosts };
      },
      async recordTags(eventId, tags) {
        repo.tagsByEvent.set(eventId, tags);
        repo.taggedPosts += 1;
        for (const tag of tags) repo.tagCounts[tag] = (repo.tagCounts[tag] ?? 0) + 1;
      },
      async eventsByAnyTag(tags, limit) {
        const wanted = new Set(tags);
        return repo.events
          .filter((e) => e.metadata && tagsOf(e.metadata).some((t) => wanted.has(t)))
          .slice(0, limit);
      },
      async recordMatchOffer(offer) {
        repo.matchOffers = [...repo.matchOffers, offer];
      },
      async resolveMatchOffer(token, outcome) {
        repo.matchOffers = repo.matchOffers.map((o) =>
          o.token === token
            ? { ...o, resolvedAt: outcome.at, joinedThreadId: outcome.joinedThreadId }
            : o,
        );
      },

      // -- Threads -----------------------------------------------------------
      async findThread(id) {
        return repo.threads.find((t) => t.id === id);
      },
      async threadsBySlug(slug) {
        return repo.threads.filter((t) => t.slug === slug);
      },
      async allThreads() {
        return [...repo.threads];
      },
      async saveThread(thread) {
        const existing = repo.threads.some((t) => t.id === thread.id);
        repo.threads = existing
          ? repo.threads.map((t) => (t.id === thread.id ? thread : t))
          : [...repo.threads, thread];
      },
      async postsInThread(threadId) {
        return repo.events.filter((e) => e.thread?.threadId === threadId);
      },

      // -- Standing subscriptions -------------------------------------------
      async saveSubscription(subscription) {
        const existing = repo.subscriptions.some((s) => s.id === subscription.id);
        repo.subscriptions = existing
          ? repo.subscriptions.map((s) => (s.id === subscription.id ? subscription : s))
          : [...repo.subscriptions, subscription];
      },
      async findSubscription(id) {
        return repo.subscriptions.find((s) => s.id === id);
      },
      async subscriptionsFor(agentId) {
        return repo.subscriptions.filter((s) => s.agentId === agentId);
      },
      async activeSubscriptions() {
        return repo.subscriptions.filter((s) => s.active);
      },
      async deleteSubscription(id) {
        repo.subscriptions = repo.subscriptions.filter((s) => s.id !== id);
      },
      async allEvents() {
        return [...repo.events];
      },

      // -- Proving something is running --------------------------------------
      async saveChallenge(challenge) {
        const existing = repo.challenges.some((c) => c.id === challenge.id);
        repo.challenges = existing
          ? repo.challenges.map((c) => (c.id === challenge.id ? challenge : c))
          : [...repo.challenges, challenge];
      },
      async findChallenge(id) {
        return repo.challenges.find((c) => c.id === id);
      },
      async passedChallengesFor(agentId) {
        return repo.challenges
          .filter((c) => c.agentId === agentId && c.passed && c.respondedAt)
          .map((c) => c.respondedAt!)
          .sort();
      },
      async webhookSecretFor(agentId) {
        return repo.webhookSecrets.get(agentId);
      },
      /**
       * Everything this agent did, for cadence conformance. Posts, comments,
       * jobs and votes all count — an agent that only ever posts is still
       * running on a schedule, and one that only ever votes is too.
       */
      async activityFor(agentId) {
        const times = [
          ...repo.events.filter((e) => e.authorId === agentId).map((e) => e.createdAt),
          ...repo.comments.filter((c) => c.authorId === agentId).map((c) => c.createdAt),
          ...repo.jobs.filter((j) => j.agentId === agentId).map((j) => j.reportedAt),
          ...repo.pollVotes.filter((v) => v.agentId === agentId).map((v) => v.createdAt),
        ];
        return times.sort();
      },
      async attestationsFor(agentId) {
        return repo.attestations.filter((a) => a.subjectAgentId === agentId);
      },
      async setTrustTier(agentId, tier, method) {
        return repo.patchAgent(agentId, {
          trustTier: tier,
          promotedBy: method,
          promotedAt: new Date().toISOString(),
        });
      },

      nextId: (prefix) => nextId(prefix),
      now: () => new Date(),
    };
  }

  // -- Flow B: the agent registers itself ----------------------------------

  async registerAgent(req: AgentRegistrationRequest): Promise<AgentRegistrationResponse> {
    const invalid = validateRegistration(req);
    if (invalid) throw new Error(invalid.message);

    const taken = new Set([
      ...this.agents.map((a) => a.handle),
      ...this.builders.map((b) => b.handle),
      ...this.studios.map((s) => s.handle),
    ]);
    const handle = resolveHandleCollision(normalizeHandle(req.requestedHandle), taken);
    const now = new Date();
    const agentId = nextId('agent');
    const discriminator = this.nextDiscriminator(req.name);
    if (!discriminator) {
      throw new Error(`Too many agents are already named "${req.name.trim()}".`);
    }

    // Self-registration never creates a relationship. Identity now, ownership
    // later — and only once a human proves it.
    const agent = buildAgentFromRegistration(req, {
      agentId,
      handle,
      discriminator,
      joinedAt: now.toISOString(),
      claimStatus: 'unclaimed',
      verificationStatus: 'unverified',
      registrationSource: 'self_registered',
    });
    this.agents = [...this.agents, agent];

    const claim = createClaim({
      id: nextId('claim'),
      agentId,
      handle,
      claimantType: 'builder',
      claimantId: '',
      now,
    });
    this.claims = [...this.claims, claim];

    const joinEvent: FeedEvent = {
      id: nextId('evt'),
      type: 'agent_joined',
      authorType: 'agent',
      authorId: agentId,
      createdAt: now.toISOString(),
      provenance: { mode: 'system' },
      engagement: { likes: 0, comments: 0, saves: 0 },
      payload: {
        bornAt: agent.joinedAt,
        registrationSource: 'self_registered',
        claimStatusAtJoin: 'unclaimed',
      },
    };
    const created: FeedEvent[] = [joinEvent];

    let helloWorldEventId: string | undefined;
    if (req.firstPost?.content) {
      const hello: FeedEvent = {
        id: nextId('evt'),
        type: 'hello_world',
        authorType: 'agent',
        authorId: agentId,
        createdAt: new Date(now.getTime() + 1000).toISOString(),
        provenance: { mode: 'autonomous' },
        engagement: { likes: 0, comments: 0, saves: 0 },
        payload: { greeting: req.firstPost.content },
      };
      helloWorldEventId = hello.id;
      created.push(hello);
      this.patchAgent(agentId, { firstPostId: hello.id });
    }
    this.events = [...created.reverse(), ...this.events];

    return {
      agentId,
      handle,
      discriminator,
      tag: agentTag(agent),
      joinedAt: agent.joinedAt,
      claimStatus: 'unclaimed',
      verificationStatus: 'unverified',
      registrationSource: 'self_registered',
      claimCode: claim.claimCode,
      claimCodeExpiresAt: claim.expiresAt,
      joinEventId: joinEvent.id,
      helloWorldEventId,
    };
  }

  // -- Flow A: a signed-in operator creates the agent ----------------------

  async createAgent(input: CreateAgentInput, creator: { type: SubjectType; id: string }) {
    // The disclosure is screened on this path too — a Builder pasting a
    // connection string into "what does it do" is the likeliest way a secret
    // ends up on a public profile.
    const badDisclosure = validateDisclosure(input.disclosure);
    if (badDisclosure) throw new Error(badDisclosure.message);

    const taken = new Set(this.agents.map((a) => a.handle));
    const handle = resolveHandleCollision(normalizeHandle(input.handle || input.name), taken);
    const now = new Date();
    const agentId = nextId('agent');

    const agent: Agent = {
      id: agentId,
      type: 'agent',
      name: input.name.trim(),
      handle,
      discriminator: this.nextDiscriminator(input.name) ?? '0001',
      avatar: {
        initials: input.name.trim().charAt(0).toUpperCase(),
        accent: 'blue',
        shape: 'squircle',
      },
      bio: input.description,
      tagline: input.tagline,
      category: input.category,
      capabilities: input.capabilities,
      disclosure: { ...input.disclosure, attestedAt: now.toISOString() },
      status: 'available',
      // Aiskimo watched this happen, so there is nothing left to prove.
      claimStatus: 'claimed',
      verified: true,
      verificationStatus: 'verified',
      // A verified operator vouching for it is itself a promotion signal.
      trustTier: 'established',
      promotedBy: 'operator_claim',
      promotedAt: now.toISOString(),
      registrationSource: creator.type === 'studio' ? 'studio_created' : 'builder_created',
      runtimeType: 'hosted',
      joinedAt: now.toISOString(),
      followersCount: 0,
      followingCount: 0,
    };

    const relationship: AgentRelationship = {
      id: nextId('rel'),
      agentId,
      subjectType: creator.type,
      subjectId: creator.id,
      relationshipType: 'creator',
      verified: true,
      startedAt: now.toISOString(),
    };
    const builderRel: AgentRelationship = { ...relationship, id: nextId('rel'), relationshipType: 'builder' };

    this.agents = [...this.agents, agent];
    this.relationships = [...this.relationships, relationship, builderRel];

    const events: FeedEvent[] = [
      {
        id: nextId('evt'),
        type: 'agent_joined',
        authorType: 'agent',
        authorId: agentId,
        createdAt: now.toISOString(),
        provenance: { mode: 'system' },
        engagement: { likes: 0, comments: 0, saves: 0 },
        payload: {
          bornAt: agent.joinedAt,
          registrationSource: agent.registrationSource,
          claimStatusAtJoin: 'claimed',
        },
      },
    ];
    if (input.helloWorld) {
      events.push({
        id: nextId('evt'),
        type: 'hello_world',
        authorType: 'agent',
        authorId: agentId,
        createdAt: new Date(now.getTime() + 1000).toISOString(),
        provenance: { mode: 'autonomous' },
        engagement: { likes: 0, comments: 0, saves: 0 },
        payload: { greeting: input.helloWorld },
      });
    }
    this.events = [...[...events].reverse(), ...this.events];

    return { agent, events, relationship: builderRel };
  }

  // -- Claiming -------------------------------------------------------------

  async submitClaim(submission: ClaimSubmission): Promise<ClaimResult> {
    const ref = submission.agentRef.trim().replace(/^@/, '').toLowerCase();
    const agent = this.agents.find((a) => a.handle.toLowerCase() === ref || a.id === submission.agentRef.trim());
    if (!agent) {
      return { ok: false, code: 'agent_not_found', message: `No agent found for "${submission.agentRef}".` };
    }

    const claim = this.claims.find((c) => c.agentId === agent.id && c.status === 'pending');
    const attempt = verifyClaim({
      agent,
      claim,
      claimantType: submission.claimantType,
      claimantId: submission.claimantId,
      submittedCode: submission.claimCode,
    });
    if (!attempt.ok) return { ok: false, code: attempt.code, message: attempt.message };

    const verifiedClaim: AgentClaim = {
      ...attempt.claim,
      claimantId: submission.claimantId,
      claimantType: submission.claimantType,
    };
    this.claims = this.claims.map((c) => (c.id === verifiedClaim.id ? verifiedClaim : c));
    this.relationships = [...this.relationships, attempt.relationship];

    // The agent record itself barely changes — that is the point. Followers,
    // posts, joined date and reputation all stay exactly where they were.
    const updated = this.patchAgent(agent.id, { claimStatus: 'claimed' });

    const event: FeedEvent = {
      id: nextId('evt'),
      type: 'agent_claimed',
      authorType: 'agent',
      authorId: agent.id,
      createdAt: new Date().toISOString(),
      provenance: { mode: 'system' },
      engagement: { likes: 0, comments: 0, saves: 0 },
      payload: {
        claimId: verifiedClaim.id,
        claimantType: submission.claimantType,
        claimantId: submission.claimantId,
        method: verifiedClaim.method,
        grants: verifiedClaim.grants,
      },
    };
    this.events = [event, ...this.events];

    return {
      ok: true,
      value: { agent: updated, relationship: attempt.relationship, claim: verifiedClaim, event },
    };
  }

  async publishPost(event: FeedEvent): Promise<FeedEvent> {
    this.events = [event, ...this.events];
    return event;
  }

  // -- Comments -------------------------------------------------------------

  async loadComments(eventId: string): Promise<Comment[]> {
    return this.comments.filter((c) => c.eventId === eventId);
  }

  async addComment(input: AddCommentInput): Promise<Comment> {
    const invalid = validateComment(input.body);
    if (invalid) throw new Error(invalid.message);

    const agent = this.agents.find((a) => a.id === input.agentId);
    if (!agent) throw new Error(`Unknown agent ${input.agentId}`);

    const comment: Comment = {
      id: nextId('cmt'),
      eventId: input.eventId,
      authorType: 'agent',
      authorId: agent.id,
      // Always autonomous: a comment reaching this method came from the
      // agent's own credential, not from a person.
      provenance: { mode: 'autonomous' },
      body: normalizeCommentBody(input.body),
      createdAt: new Date().toISOString(),
      likes: 0,
      replyToId: input.replyToId,
    };

    this.comments = [...this.comments, comment];
    this.bumpCommentCount(input.eventId, 1);
    return comment;
  }

  // -- Jobs & connections ---------------------------------------------------

  async loadJobs(agentId: string): Promise<ReportedJob[]> {
    return this.jobs
      .filter((j) => j.agentId === agentId)
      .sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt));
  }

  async loadConnections(agentId: string): Promise<{ followers: Agent[]; following: Agent[] }> {
    const byId = new Map(this.agents.map((a) => [a.id, a]));
    const following = [...(this.agentFollows.get(agentId) ?? [])]
      .map((id) => byId.get(id))
      .filter((a): a is Agent => Boolean(a));

    const followers: Agent[] = [];
    for (const [followerId, targets] of this.agentFollows) {
      if (targets.has(agentId)) {
        const agent = byId.get(followerId);
        if (agent) followers.push(agent);
      }
    }
    return { followers, following };
  }

  // -- FAQ ------------------------------------------------------------------

  async loadFaq(agentId: string): Promise<AgentFaqEntry[]> {
    return this.faq.filter((f) => f.agentId === agentId);
  }

  /**
   * Queues a question and notifies the agent it was asked of.
   *
   * `asker` is present when another agent asked. Reader-asked questions are
   * anonymous — and while viewer participation is closed, the agent API is the
   * only caller.
   */
  async askQuestion(
    agentId: string,
    question: string,
    asker?: { agentId: string; agentName: string },
  ): Promise<AgentFaqEntry> {
    const body = normalizeCommentBody(question);
    if (!body) throw new Error('Write a question first.');

    // If the same thing has been asked before, count it rather than duplicating
    // it — the agent should answer a question once.
    const existing = this.faq.find(
      (f) => f.agentId === agentId && f.question.toLowerCase().trim() === body.toLowerCase(),
    );
    if (existing) {
      const bumped = { ...existing, askedCount: existing.askedCount + 1 };
      this.faq = this.faq.map((f) => (f.id === existing.id ? bumped : f));
      return bumped;
    }

    const now = new Date().toISOString();
    const entry: AgentFaqEntry = {
      id: nextId('faq'),
      agentId,
      question: body,
      status: 'pending',
      askedAt: now,
      provenance: { mode: 'autonomous' },
      askedCount: 1,
    };
    this.faq = [...this.faq, entry];

    // The agent has to find out, or the question sits forever. Readers are
    // signed out, so there is no actor to name.
    this.notifications = [
      ...this.notifications,
      {
        id: nextId('ntf'),
        agentId,
        type: 'question_asked',
        createdAt: now,
        read: false,
        actor: asker ? { type: 'agent', id: asker.agentId } : undefined,
        actorName: asker?.agentName ?? 'Someone',
        faqEntryId: entry.id,
        content: untrusted(body),
        respondWith: {
          endpoint: ENDPOINTS.answers,
          method: 'POST',
          body: { faqEntryId: entry.id, answer: '' },
        },
      },
    ];

    return entry;
  }

  /** Keeps the collapsed card counter in step with the thread. */
  private bumpCommentCount(eventId: string, delta: number): void {
    this.events = this.events.map((e) =>
      e.id === eventId
        ? { ...e, engagement: { ...e.engagement, comments: e.engagement.comments + delta } }
        : e,
    );
  }

  async loadSocialState(): Promise<SocialState> {
    return {
      follows: { ...this.social.follows },
      likes: { ...this.social.likes },
      saves: { ...this.social.saves },
      joins: { ...this.social.joins },
    };
  }

  async setSocialFlag(
    _viewerId: string,
    bucket: keyof SocialState,
    key: string,
    value: boolean,
  ): Promise<void> {
    this.social = { ...this.social, [bucket]: { ...this.social[bucket], [key]: value } };
  }

  /**
   * Read-side adapter. Separate from `gatewayStore` because reading needs no
   * write access at all, and keeping the surfaces apart makes that obvious.
   */
  readStore(): ReadStore {
    const repo = this;
    return {
      /**
       * Pages in memory, which is what the Firestore adapter does in the
       * database. Cursors are the same opaque `createdAt|id` token in both, so
       * a cursor issued by one is meaningful to the other and the two cannot
       * disagree about where a page ends.
       */
      async pageEvents(query) {
        let selected = repo.events.filter((event) => {
          if (query.types?.length && !query.types.includes(event.type)) return false;
          if (query.authorId && event.authorId !== query.authorId) return false;
          if (query.since && Date.parse(event.createdAt) <= Date.parse(query.since)) return false;
          return true;
        });

        const newest = (a: FeedEvent, b: FeedEvent) =>
          Date.parse(b.createdAt) - Date.parse(a.createdAt);
        switch (query.sort) {
          case 'oldest':
            selected = selected.sort((a, b) => -newest(a, b));
            break;
          case 'most_liked':
            selected = selected.sort(
              (a, b) => b.engagement.likes - a.engagement.likes || newest(a, b),
            );
            break;
          case 'most_discussed':
            selected = selected.sort(
              (a, b) => b.engagement.comments - a.engagement.comments || newest(a, b),
            );
            break;
          default:
            selected = selected.sort(newest);
        }

        const after = decodeCursor(query.cursor);
        const start = after
          ? selected.findIndex((e) => e.id === after.id) + 1
          : 0;
        const events = selected.slice(start, start + query.limit);
        const last = events[events.length - 1];

        return {
          events,
          nextCursor:
            start + query.limit < selected.length && last ? encodeCursor(last) : undefined,
          // The newest in the *filtered set*, so a poller passing this back as
          // `since` skips everything it has already seen.
          latestAt: selected.reduce<string | undefined>(
            (max, e) => (!max || Date.parse(e.createdAt) > Date.parse(max) ? e.createdAt : max),
            undefined,
          ),
        };
      },
      async recentEvents(limit) {
        return [...repo.events]
          .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
          .slice(0, limit);
      },
      async findEvent(eventId) {
        return repo.events.find((e) => e.id === eventId);
      },
      async postsInThread(threadId) {
        return repo.events.filter((e) => e.thread?.threadId === threadId);
      },
      async threadsBySlug(slug) {
        return repo.threads.filter((t) => t.slug === slug);
      },
      async allCaveatRecords() {
        return [...repo.caveatRecords];
      },
      async allThreads() {
        return [...repo.threads];
      },
      async allFaqEntries() {
        return [...repo.faq];
      },
      async allOpenQuestions() {
        return [...repo.openQuestions];
      },
      async allAgents() {
        return [...repo.agents];
      },
      async accountsFor(ids) {
        const wanted = new Set(ids);
        const map: Record<string, Account> = {};
        for (const account of [...repo.agents, ...repo.builders, ...repo.studios]) {
          if (wanted.has(account.id)) map[account.id] = account;
        }
        return map;
      },
      async operatorsById() {
        const map: Record<string, Builder | Studio> = {};
        for (const op of [...repo.builders, ...repo.studios]) map[op.id] = op;
        return map;
      },
      async relationshipsFor(agentId) {
        return repo.relationships.filter((r) => r.agentId === agentId);
      },
      async commentsFor(eventId) {
        return repo.comments.filter((c) => c.eventId === eventId);
      },
      async jobsFor(agentId) {
        return repo.jobs.filter((j) => j.agentId === agentId);
      },
      async attestationsFor(agentId) {
        return repo.attestations.filter((a) => a.subjectAgentId === agentId);
      },
      async faqFor(agentId) {
        return repo.faq.filter((f) => f.agentId === agentId);
      },
      async connectionsFor(agentId) {
        return repo.loadConnections(agentId);
      },
      async findPoll(id) {
        return repo.polls.find((p) => p.id === id);
      },
      async pollVotes(pollId) {
        return repo.pollVotes.filter((v) => v.pollId === pollId);
      },
      async findAgentByRef(ref) {
        return repo.agents.find((a) => matchesRef(a, ref));
      },
      now: () => new Date(),
    };
  }

  /** A free four-digit discriminator for this name, or null if all 9,999 are used. */
  private nextDiscriminator(name: string): string | null {
    const key = nameKey(name);
    const taken = new Set(
      this.agents.filter((a) => nameKey(a.name) === key).map((a) => a.discriminator),
    );
    return assignDiscriminator(taken);
  }

  private patchAgent(id: string, patch: Partial<Agent>): Agent {
    let updated: Agent | undefined;
    this.agents = this.agents.map((a) => {
      if (a.id !== id) return a;
      updated = { ...a, ...patch };
      return updated;
    });
    if (!updated) throw new Error(`Agent ${id} not found`);
    return updated;
  }
}

