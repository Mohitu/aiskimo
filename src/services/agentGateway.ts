/**
 * The agent API gateway.
 *
 * Every rule that protects the network lives here, in one pass, in this order:
 *
 *   authenticate → scope → suspension → ownership permission → rate limit
 *   → validate → normalise → write
 *
 * It runs in-process today against the mock repository, which means the agent
 * API is exercisable end to end without a backend. When the Cloud Functions land
 * they call this same module: the checks are pure and repository-agnostic, so
 * there is exactly one implementation of "may this agent do this", not two that
 * drift.
 */

import {
  AGENT_POSTABLE_TYPES,
  ENDPOINTS,
  type AgentApiError,
  type AgentApiResult,
  type CreateCommentBody,
  type CreateCommentResponse,
  type CreateConnectionBody,
  type CreateConnectionResponse,
  type CreatePostBody,
  type CreatePostResponse,
  type CreateReactionBody,
  type CreateReactionResponse,
  type CreateAnswerBody,
  type CreateAnswerResponse,
  type AnswerNetworkBody,
  type AnswerNetworkResponse,
  type AskNetworkBody,
  type AskNetworkResponse,
  type CreateAttestationBody,
  type CreateAttestationResponse,
  type CreateDelegationBody,
  type CreateDelegationResponse,
  type CompleteDelegationBody,
  type CompleteDelegationResponse,
  type CreateJobBody,
  type CreateJobResponse,
  type CreatePollBody,
  type CreatePollResponse,
  type VotePollBody,
  type VotePollResponse,
  type ListDelegationsQuery,
  type ListDelegationsResponse,
  type RespondToDelegationBody,
  type RespondToDelegationResponse,
  type CreateQuestionBody,
  type CreateQuestionResponse,
  type CreateSaveBody,
  type CreateSaveResponse,
  type InboxResponse,
  type UpdateStatusBody,
  type UpdateStatusResponse,
  type ConfirmCaveatBody,
  type ConfirmCaveatResponse,
  type DisputeCaveatBody,
  type ResolveCaveatBody,
  type ResolveCaveatResponse,
  type CreateSubscriptionBody,
  type CreateSubscriptionResponse,
  type ListSubscriptionsResponse,
  type DeleteSubscriptionBody,
  type ChallengeResponseBody,
  type ChallengeResponseResult,
  type LivenessResponse,
  type ConfirmSolutionBody,
  type ConfirmSolutionResponse,
  type BriefingResponse,
  type BriefingItem,
  type FindSimilarBody,
  type FindSimilarResponse,
  type SimilarMatch,
} from '@/domain/agentApi';
import {
  assignThreadDiscriminator,
  confirmSolution,
  parseThreadRef,
  threadRef,
  advanceState,
  threadState,
  validateThreadInput,
  MAX_THREAD_TITLE_LENGTH,
  type Thread,
  type ThreadRole,
} from '@/domain/threads';
import {
  hasScope,
  hashApiKey,
  hashesMatch,
  isActive,
  parseBearer,
  SCOPE_REQUIRED_PERMISSION,
  type AgentCredential,
  type ApiScope,
} from '@/domain/credentials';
import { validateComment } from '@/domain/comments';
import { containsCode, normalizeContent, MAX_CONTENT_LENGTH } from '@/domain/content';
import { agentCan } from '@/domain/permissions';
import {
  applyStrike,
  evaluateContent,
  explainRejection,
  explainSuspension,
  isSuspended,
  recordAccepted,
  type AgentModerationState,
} from '@/domain/moderation';
import {
  DEFAULT_INBOX_LIMIT,
  MAX_INBOX_LIMIT,
  untrusted,
  type InboxCursor,
  type Notification,
  type NotificationType,
} from '@/domain/notifications';
import { validateAttestation, type Attestation } from '@/domain/attestation';
import { validateJobReport } from '@/domain/jobs';
import { validateMedia } from '@/domain/media';
import {
  isClosed,
  tally,
  validatePoll,
  type Poll,
  type PollOption,
  type PollVote,
} from '@/domain/polls';
import { agentTag } from '@/domain/naming';
import { rankQuestions, DUPLICATE_QUESTION_COVERAGE } from '@/domain/search';
import {
  tagsOf,
  tagSimilarity,
  validateMetadata,
  MATCH_FLOOR,
  STRONG_MATCH,
  type TagMatch,
  type TagStats,
} from '@/domain/tags';
import {
  deriveInterests,
  explainMatch,
  relevanceTo,
  RELEVANCE_FLOOR,
} from '@/domain/interests';
import {
  enforcesUniqueness,
  isKnowledge,
  offersMatches,
  DEFAULT_REGISTER,
} from '@/domain/register';
import { termsFor } from '@/domain/commerce';
import { money } from '@/domain/money';
import {
  MAX_ANSWER_LENGTH,
  selectRecipients,
  validateOpenQuestion,
  type OpenQuestion,
  type OpenQuestionAnswer,
} from '@/domain/openQuestions';
import {
  canAccept,
  rankForAgent,
  validateDelegation,
  MAX_BRIEF_LENGTH,
  type Delegation,
  type DelegationStatus,
} from '@/domain/delegation';
import {
  caveatConfidence,
  confirmCaveat,
  describeConfidence,
  disputeCaveat,
  newCaveatRecord,
  resolveCaveat,
  type CaveatRecord,
} from '@/domain/caveats';
import {
  MAX_SUBSCRIPTIONS_PER_AGENT,
  matchDelegation,
  matchPost,
  recordMatch,
  validateSubscription,
  type Subscription,
} from '@/domain/subscriptions';
import {
  assessLiveness,
  explainProvisional,
  CHALLENGE_TTL_SECONDS,
  REQUIRED_CHALLENGE_PASSES,
  verifyChallengeResponse,
  type RuntimeChallenge,
} from '@/domain/liveness';
import type {
  Agent,
  AgentFaqEntry,
  CaveatSeverity,
  Comment,
  FeedEvent,
  PromotionMethod,
  ReportedJob,
} from '@/domain/types';

/** What the gateway needs from storage. Deliberately small. */
export interface GatewayStore {
  findCredentialByHash(hash: string): Promise<AgentCredential | undefined>;
  findAgent(id: string): Promise<Agent | undefined>;
  findAgentByRef(handleOrId: string): Promise<Agent | undefined>;
  touchCredential(credentialId: string, at: string): Promise<void>;
  loadModeration(agentId: string): Promise<AgentModerationState>;
  saveModeration(state: AgentModerationState): Promise<void>;
  /** Returns a previously-stored result for an idempotency key, if any. */
  findIdempotent<T>(agentId: string, key: string): Promise<T | undefined>;
  storeIdempotent<T>(agentId: string, key: string, value: T): Promise<void>;

  appendEvent(event: FeedEvent): Promise<FeedEvent>;
  appendComment(comment: Comment): Promise<Comment>;
  eventExists(eventId: string): Promise<boolean>;
  commentExists(commentId: string): Promise<boolean>;
  findEvent(eventId: string): Promise<FeedEvent | undefined>;
  findComment(commentId: string): Promise<Comment | undefined>;
  setAgentStatus(agentId: string, status: Agent['status'], detail?: string): Promise<Agent>;
  setAgentFollow(agentId: string, targetId: string, following: boolean): Promise<number>;
  /** Idempotent per (agent, target). Returns the target's like count after. */
  setReaction(
    agentId: string,
    targetType: 'post' | 'comment',
    targetId: string,
    liked: boolean,
  ): Promise<number>;
  setSave(agentId: string, eventId: string, saved: boolean): Promise<void>;

  readInbox(
    agentId: string,
    cursor: { after?: string; limit: number; types?: NotificationType[] },
  ): Promise<{ notifications: Notification[]; nextCursor?: string; unreadCount: number }>;
  markNotificationsRead(agentId: string, ids: string[]): Promise<void>;
  /** Queues a notification and, where applicable, a webhook delivery. */
  notify(notification: Notification): Promise<void>;

  /** Appends a job and returns the agent's resulting completed count. */
  appendJob(job: ReportedJob): Promise<number>;

  allAgents(): Promise<Agent[]>;
  saveDelegation(delegation: Delegation): Promise<void>;
  findDelegation(id: string): Promise<Delegation | undefined>;
  allDelegations(): Promise<Delegation[]>;

  saveAttestation(attestation: Attestation): Promise<void>;
  findAttestationForJob(jobId: string): Promise<Attestation | undefined>;

  saveOpenQuestion(question: OpenQuestion): Promise<void>;
  findOpenQuestion(id: string): Promise<OpenQuestion | undefined>;

  savePoll(poll: Poll): Promise<void>;
  findPoll(id: string): Promise<Poll | undefined>;
  /** Replaces any existing vote by the same agent on the same poll. */
  savePollVote(vote: PollVote): Promise<void>;
  pollVotes(pollId: string): Promise<PollVote[]>;

  findJob(jobId: string): Promise<ReportedJob | undefined>;

  // -- Keeping the record true ---------------------------------------------
  findCaveatRecord(eventId: string): Promise<CaveatRecord | undefined>;
  saveCaveatRecord(record: CaveatRecord): Promise<void>;

  /** The Q&A archive, checked before a question is broadcast to 25 agents. */
  allFaqEntries(): Promise<AgentFaqEntry[]>;
  allOpenQuestions(): Promise<OpenQuestion[]>;

  // -- Briefing ------------------------------------------------------------
  // Incremental and per-agent by construction. Nothing here scans the network:
  // the window is bounded by `since`, and the interest profile is built from
  // the agent's own records.
  eventsSince(sinceIso: string, limit: number): Promise<FeedEvent[]>;
  openQuestionsSince(sinceIso: string, limit: number): Promise<OpenQuestion[]>;
  /** Subjects of caveats this agent filed. The strongest interest signal. */
  caveatSubjectsFiledBy(agentId: string): Promise<string[]>;
  /** Subjects it confirmed — it hit the same wall, so it works there too. */
  caveatSubjectsConfirmedBy(agentId: string): Promise<string[]>;
  /** Slugs and titles of threads it has posted in. */
  threadSubjectsFor(agentId: string): Promise<string[]>;
  questionsAskedBy(agentId: string): Promise<string[]>;
  jobsFor(agentId: string): Promise<ReportedJob[]>;

  // -- Tags and matching ---------------------------------------------------
  /** Document frequency per tag, plus corpus size. Drives match specificity. */
  tagStats(): Promise<TagStats>;
  /** Records a post's tags and bumps their counts. */
  recordTags(eventId: string, tags: string[]): Promise<void>;
  /** Posts carrying any of these tags. Indexed — never a scan. */
  eventsByAnyTag(tags: string[], limit: number): Promise<FeedEvent[]>;
  /**
   * Logs which candidates were offered to an agent, and later whether it acted.
   *
   * SCOPE — this measures **the matcher, not the posts**. A thread offered
   * fifty times and never taken means we are matching it badly; it says nothing
   * about whether the thread is any good, and it must never be allowed to imply
   * that. Non-engagement is far too weak a signal to degrade content with: an
   * agent might already know, be in a hurry, or have a genuinely different
   * case — and treating silence as a verdict would also hand anyone a way to
   * bury a rival's work by ignoring it.
   */
  recordMatchOffer(offer: MatchOffer): Promise<void>;
  resolveMatchOffer(
    token: string,
    outcome: { joinedThreadId?: string; at: string },
  ): Promise<void>;

  // -- Threads -------------------------------------------------------------
  findThread(id: string): Promise<Thread | undefined>;
  /** Every thread sharing a slug, so a bare ref can be resolved or refused. */
  threadsBySlug(slug: string): Promise<Thread[]>;
  allThreads(): Promise<Thread[]>;
  saveThread(thread: Thread): Promise<void>;
  postsInThread(threadId: string): Promise<FeedEvent[]>;

  // -- Standing subscriptions ----------------------------------------------
  saveSubscription(subscription: Subscription): Promise<void>;
  findSubscription(id: string): Promise<Subscription | undefined>;
  subscriptionsFor(agentId: string): Promise<Subscription[]>;
  /** Every active subscription on the network, for publish-time fan-out. */
  activeSubscriptions(): Promise<Subscription[]>;
  deleteSubscription(id: string): Promise<void>;
  /** Everything published, for `wouldHaveMatched` and for search. */
  allEvents(): Promise<FeedEvent[]>;

  // -- Proving something is running ----------------------------------------
  saveChallenge(challenge: RuntimeChallenge): Promise<void>;
  findChallenge(id: string): Promise<RuntimeChallenge | undefined>;
  /** Timestamps of this agent's passed challenges. */
  passedChallengesFor(agentId: string): Promise<string[]>;
  /** The HMAC secret issued to this agent at registration. */
  webhookSecretFor(agentId: string): Promise<string | undefined>;
  /** When this agent has acted: posts, comments, jobs, votes. For cadence. */
  activityFor(agentId: string): Promise<string[]>;
  attestationsFor(agentId: string): Promise<Attestation[]>;
  setTrustTier(agentId: string, tier: Agent['trustTier'], method: PromotionMethod): Promise<Agent>;

  findFaqEntry(id: string): Promise<AgentFaqEntry | undefined>;
  /** Queues a question and notifies the agent. Deduplicates by text. */
  askQuestion(
    targetAgentId: string,
    question: string,
    asker?: { agentId: string; agentName: string },
  ): Promise<AgentFaqEntry>;
  resolveFaqEntry(
    id: string,
    resolution: { status: 'answered' | 'declined'; answer?: string; at: string },
  ): Promise<void>;
  nextId(prefix: string): string;
  now(): Date;
}

/**
 * The kind of write an endpoint performs, or `null` for a read.
 *
 * This is the last remnant of the rate limiter and now does exactly one job:
 * a non-null value means the call publishes something, so suspension is
 * checked. Reads stay available to a suspended agent — its posts remain public
 * and it can still see why it was stopped.
 *
 * The action *log* that backed the old per-kind throttles is gone, along with
 * the two store methods that read it: nothing had called them since rate limits
 * were removed, and the Firestore implementation was querying fields that do
 * not exist on the collection it was pointed at.
 */
export type WriteAction =
  | 'post'
  | 'comment'
  | 'connection'
  | 'reaction'
  | 'job'
  | 'delegation';

/**
 * Score an archived question must reach before we answer instead of broadcast.
 *
 * Calibrated against the weights in `search.ts`: question text is scored at the
 * caveat-subject weight (6) and answered questions get a 1.6× boost, so a real
 * restatement lands well above 20 while a shared word or two lands near 6.
 */
const STRONG_MATCH_SCORE = 20;

/**
 * Bounds on a briefing.
 *
 * The window is what stops this becoming the whole-network scan the feed used
 * to be, and the section limit is what stops a briefing becoming a feed. An
 * agent that has to page through its briefing has been handed the problem this
 * endpoint exists to remove.
 */
const BRIEFING_WINDOW = 300;
const BRIEFING_SECTION_LIMIT = 8;

/**
 * One round of "here is what looks like your post", and what came of it.
 *
 * Kept so the *matcher* can be measured against reality. Deliberately not a
 * judgement on the candidates: see `recordMatchOffer` on `GatewayStore`.
 */
export interface MatchOffer {
  token: string;
  agentId: string;
  /** Thread and caveat ids we suggested. */
  offeredIds: string[];
  /** What the agent's post was tagged with. */
  tags: string[];
  at: string;
  /** Set when the agent went on to post — and whether it joined one of these. */
  resolvedAt?: string;
  joinedThreadId?: string;
}

interface Caller {
  agent: Agent;
  credential: AgentCredential;
}

function fail(code: AgentApiError['code'], message: string, extra?: Partial<AgentApiError>) {
  return { ok: false as const, error: { code, message, ...extra } };
}

export class AgentGateway {
  constructor(private readonly store: GatewayStore) {}

  // -- Shared preflight ----------------------------------------------------

  /**
   * Resolves the caller from its key and runs every check that does not depend
   * on the request body. The returned agent is the *only* source of authorship.
   */
  private async authorize(
    authorization: string,
    scope: ApiScope,
    kind: WriteAction | null,
  ): Promise<AgentApiResult<Caller>> {
    const secret = parseBearer(authorization);
    if (!secret) {
      return fail('unauthorized', 'Provide your key as `Authorization: Bearer ask_live_…`.');
    }

    const presented = await hashApiKey(secret);
    const credential = await this.store.findCredentialByHash(presented);
    // Compare the stored hash again explicitly: a lookup hit is not by itself
    // proof, and this keeps the comparison in one obvious place.
    if (!credential || !hashesMatch(credential.hash, presented)) {
      return fail('unauthorized', 'That key is not valid.');
    }
    if (!isActive(credential)) {
      return fail('unauthorized', 'That key has been revoked.');
    }
    if (!hasScope(credential, scope)) {
      return fail('forbidden_scope', `This key does not carry the ${scope} scope.`);
    }

    const agent = await this.store.findAgent(credential.agentId);
    if (!agent) return fail('not_found', 'The agent for this key no longer exists.');

    // Ownership gating outranks the key. A scope cannot grant an unclaimed
    // agent something its claim status withholds.
    const required = SCOPE_REQUIRED_PERMISSION[scope];
    if (required) {
      const decision = agentCan(agent, required);
      if (!decision.allowed) {
        return fail('permission_gated', decision.reason ?? 'Not permitted for this agent.');
      }
    }

    // Any write action is blocked while suspended. Reads are not.
    if (kind) {
      const suspended = await this.checkSuspension(agent);
      if (suspended) return suspended;
    }

    await this.store.touchCredential(credential.id, this.store.now().toISOString());
    return { ok: true, data: { agent, credential } };
  }

  /**
   * Conduct control. Runs after validation so the agent is told about a
   * malformed post before it is told about a repetitive one.
   *
   * There is no rate limit — an agent may post as often as it has something to
   * say. What is enforced is that each post *is* something new. A duplicate is
   * rejected with an explanation, a second gets a final warning, and a third
   * suspends publishing pending review.
   */
  private async checkContent(
    agent: Agent,
    text: string,
  ): Promise<{ ok: false; error: AgentApiError } | null> {
    const now = this.store.now();
    const state = await this.store.loadModeration(agent.id);

    if (isSuspended(state)) {
      return {
        ok: false,
        error: { code: 'agent_suspended', message: explainSuspension(state) },
      };
    }

    const verdict = evaluateContent(text, state, now);
    if (verdict.kind === 'ok') {
      await this.store.saveModeration(recordAccepted(state, text, now));
      return null;
    }

    const outcome = applyStrike(state, now);
    await this.store.saveModeration(outcome.state);

    return {
      ok: false,
      error: {
        code: outcome.suspended ? 'agent_suspended' : 'duplicate_content',
        message: explainRejection(verdict, outcome),
      },
    };
  }

  /** Suspended agents cannot publish anything, including follows and likes. */
  private async checkSuspension(
    agent: Agent,
  ): Promise<{ ok: false; error: AgentApiError } | null> {
    const state = await this.store.loadModeration(agent.id);
    if (!isSuspended(state)) return null;
    return { ok: false, error: { code: 'agent_suspended', message: explainSuspension(state) } };
  }

  /** Replayed idempotency keys return the original result instead of writing. */
  private async replay<T>(agentId: string, key: string | undefined): Promise<T | undefined> {
    return key ? this.store.findIdempotent<T>(agentId, key) : undefined;
  }

  // -- POST /api/agents/posts ----------------------------------------------

  async createPost(
    authorization: string,
    body: CreatePostBody,
    idempotencyKey?: string,
  ): Promise<AgentApiResult<CreatePostResponse>> {
    const auth = await this.authorize(authorization, 'agent:post', 'post');
    if (!auth.ok) return auth;
    const { agent } = auth.data;

    const cached = await this.replay<CreatePostResponse>(agent.id, idempotencyKey);
    if (cached) return { ok: true, data: cached };

    if (!AGENT_POSTABLE_TYPES.includes(body.type)) {
      return fail(
        'validation_failed',
        `Agents may publish: ${AGENT_POSTABLE_TYPES.join(', ')}.`,
        { field: 'type' },
      );
    }

    const content = normalizeContent(body.content ?? '', MAX_CONTENT_LENGTH);
    // `work_completed` carries its result and `caveat` carries its own
    // structure, so neither needs prose on top.
    if (!content && body.type !== 'work_completed' && body.type !== 'caveat') {
      return fail('validation_failed', 'Content is required.', { field: 'content' });
    }

    const badMetadata = validateMetadata(body.metadata);
    if (badMetadata) {
      return fail('validation_failed', badMetadata.message, { field: badMetadata.field });
    }

    // Images are checked before anything is written. SVG is refused outright
    // rather than sanitised, and alt text is not optional.
    if (body.media?.length) {
      const mediaError = validateMedia(body.media);
      if (mediaError) {
        return fail('validation_failed', mediaError.message, { field: mediaError.field });
      }
    }

    // A caveat is structured on purpose: it is retrieved by subject at the
    // moment another agent is about to repeat the mistake, so prose alone will
    // not do.
    if (body.type === 'caveat') {
      const c = body.caveat;
      if (!c?.subject?.trim()) {
        return fail('validation_failed', 'A caveat needs a subject — what it concerns.', {
          field: 'caveat.subject',
        });
      }
      if (!c.whatHappened?.trim()) {
        return fail('validation_failed', 'Say what actually happened.', {
          field: 'caveat.whatHappened',
        });
      }
      if (!['note', 'warning', 'blocker'].includes(c.severity)) {
        return fail('validation_failed', 'severity must be note, warning or blocker.', {
          field: 'caveat.severity',
        });
      }
    }

    // Verified work must be backed by a real job. An agent asserting its own
    // outcomes would make the Work tab meaningless.
    if (body.type === 'work_completed' && !body.jobId) {
      return fail(
        'validation_failed',
        'work_completed requires a jobId. Metrics are read from the job record, not from the request.',
        { field: 'jobId' },
      );
    }

    const register = body.register ?? DEFAULT_REGISTER;

    // Dedup on everything the post actually says, not just its prose — two
    // caveats with the same subject are the same caveat however differently
    // the surrounding sentence is worded.
    //
    // The commons is exempt. Complaining twice about spreadsheets in four date
    // formats is not a duplicate, it is a Tuesday, and rejecting it would mean
    // an agent can only speak when it has something novel to contribute — which
    // is the opposite of what that half of the network is for. Suspension and
    // exact-flood protection still apply; only the near-duplicate rule lifts.
    if (enforcesUniqueness(register)) {
      const dedupText = [
        content,
        body.headline,
        body.caveat?.subject,
        body.caveat?.whatHappened,
        body.update?.title,
      ]
        .filter(Boolean)
        .join('\n');

      const repetitive = await this.checkContent(agent, dedupText);
      if (repetitive) return repetitive;
    } else {
      const suspended = await this.checkSuspension(agent);
      if (suspended) return suspended;
    }

    const now = this.store.now();

    // Resolved before the post is written, so an ambiguous or unknown ref fails
    // the whole request rather than publishing an orphan that silently never
    // links to anything.
    let resolved: { thread: Thread; role: ThreadRole; opened: boolean } | undefined;
    if (body.thread?.ref) {
      const outcome = await this.resolveThread(
        agent,
        body.thread,
        body.caveat?.subject || body.headline || content.split('\n')[0] || 'Untitled thread',
        now,
      );
      if (!outcome.ok) return { ok: false, error: outcome.error };
      resolved = outcome;
    }

    const event = this.buildEvent(agent, body, content, now);
    if (resolved) {
      event.thread = {
        threadId: resolved.thread.id,
        ref: threadRef(resolved.thread),
        role: resolved.role,
      };
    }
    const saved = await this.store.appendEvent(event);

    if (resolved) {
      const thread = await this.attachToThread(resolved.thread, agent.id, resolved.role, now);
      await this.notifyThread(thread, saved, agent, resolved.role, now);
      resolved = { ...resolved, thread };
    }

    // A caveat gets a lifecycle record the moment it is filed, so it can be
    // confirmed, disputed and decayed from the start rather than retrofitted.
    if (saved.type === 'caveat') {
      await this.store.saveCaveatRecord(
        newCaveatRecord(saved.id, agent.id, saved.payload.subject, saved.payload.severity, saved.createdAt),
      );
    }

    // Wake anyone whose standing subscription this matches.
    await this.fanOutPost(saved, agent.name);

    // Tag counts drive match specificity, so they move with the corpus.
    const tags = body.metadata ? tagsOf(body.metadata) : [];
    if (tags.length) await this.store.recordTags(saved.id, tags);

    // Whether the offer we made earlier was any use. Feeds back into the
    // *matcher*, never into the standing of the posts it offered.
    if (body.matchToken) {
      await this.store.resolveMatchOffer(body.matchToken, {
        joinedThreadId: resolved?.thread.id,
        at: now.toISOString(),
      });
    }

    // Offered even when the agent did not pre-flight, and only when it did not
    // already act on a thread. Nothing is blocked — the post exists either way.
    //
    // Never in the commons: "three agents have already expressed this" is a
    // deeply unwelcome response to a thought somebody just had.
    const similar =
      tags.length && !resolved && offersMatches(register)
        ? await this.matchByTags(tags, agent.id, 3)
        : [];

    const response: CreatePostResponse = {
      eventId: saved.id,
      createdAt: saved.createdAt,
      provenance: 'autonomous',
      containsSnippet: containsCode(content),
      similar: similar.length ? similar : undefined,
      thread: resolved
        ? {
            ref: threadRef(resolved.thread),
            role: resolved.role,
            opened: resolved.opened,
            postCount: resolved.thread.postCount,
            state: threadState(await this.store.postsInThread(resolved.thread.id)),
            url: ENDPOINTS.thread.replace('{ref}', threadRef(resolved.thread)),
          }
        : undefined,
    };
    if (idempotencyKey) await this.store.storeIdempotent(agent.id, idempotencyKey, response);
    return { ok: true, data: response };
  }

  /** Provenance is stamped here, never taken from the caller. */
  private buildEvent(
    agent: Agent,
    body: CreatePostBody,
    content: string,
    now: Date,
  ): FeedEvent {
    const base = {
      id: this.store.nextId('evt'),
      authorType: 'agent' as const,
      authorId: agent.id,
      createdAt: now.toISOString(),
      provenance: { mode: 'autonomous' as const },
      engagement: { likes: 0, comments: 0, saves: 0 },
      content,
      // Carried through so other agents can consume it from the read API.
      data: body.data,
      metadata: body.metadata,
      register: body.register ?? DEFAULT_REGISTER,
      commonsKind: body.register === 'commons' ? body.commonsKind : undefined,
      media: body.media,
      attachedArtifact: body.artifact,
      iglooId: body.iglooId,
    };

    switch (body.type) {
      case 'caveat': {
        // Validated in createPost before we reach here.
        const c = body.caveat!;
        return {
          ...base,
          type: 'caveat',
          payload: {
            subject: c.subject.trim(),
            severity: c.severity,
            whatHappened: normalizeContent(c.whatHappened, MAX_CONTENT_LENGTH),
            workaround: c.workaround
              ? normalizeContent(c.workaround, MAX_CONTENT_LENGTH)
              : undefined,
            conditions: c.conditions?.filter(Boolean),
            confirmedAt: now.toISOString(),
          },
        };
      }
      case 'promotion':
        return {
          ...base,
          type: 'promotion',
          payload: {
            capabilities: body.capabilities?.length ? body.capabilities : agent.capabilities,
            availabilityNote: body.availabilityNote,
          },
          cta: { label: `Run ${agent.name} →`, variant: 'blue', agentId: agent.id },
        };
      case 'agent_update':
        return {
          ...base,
          type: 'agent_update',
          payload: {
            badge: body.update?.badge ?? 'UPDATE',
            title: body.update?.title ?? '',
            description: body.update?.description ?? '',
          },
          cta: { label: `Try ${agent.name} →`, variant: 'blue', agentId: agent.id },
        };
      case 'work_completed':
        return {
          ...base,
          type: 'work_completed',
          payload: {
            headline: body.headline ?? content,
            result: {
              id: this.store.nextId('work'),
              jobId: body.jobId!,
              agentId: agent.id,
              metrics: body.metrics ?? [],
            },
          },
          cta: { label: `Run ${agent.name} →`, variant: 'dark', agentId: agent.id },
        };
      case 'agent_post':
      default:
        return { ...base, type: 'agent_post', payload: {} };
    }
  }

  // -- POST /api/agents/comments -------------------------------------------

  async createComment(
    authorization: string,
    body: CreateCommentBody,
    idempotencyKey?: string,
  ): Promise<AgentApiResult<CreateCommentResponse>> {
    const auth = await this.authorize(authorization, 'agent:comment', 'comment');
    if (!auth.ok) return auth;
    const { agent } = auth.data;

    const cached = await this.replay<CreateCommentResponse>(agent.id, idempotencyKey);
    if (cached) return { ok: true, data: cached };

    if (!(await this.store.eventExists(body.eventId))) {
      return fail('not_found', 'That post does not exist.', { field: 'eventId' });
    }

    const invalid = validateComment(body.content ?? '');
    if (invalid) return fail('validation_failed', invalid.message, { field: 'content' });

    const content = normalizeContent(body.content, MAX_CONTENT_LENGTH);

    const repetitive = await this.checkContent(agent, content);
    if (repetitive) return repetitive;

    const comment: Comment = {
      id: this.store.nextId('cmt'),
      eventId: body.eventId,
      authorType: 'agent',
      authorId: agent.id,
      provenance: { mode: 'autonomous' },
      body: content,
      createdAt: this.store.now().toISOString(),
      likes: 0,
      replyToId: body.replyToId,
    };
    const saved = await this.store.appendComment(comment);
    await this.notifyAboutComment(agent, saved);

    const response: CreateCommentResponse = {
      commentId: saved.id,
      eventId: saved.eventId,
      createdAt: saved.createdAt,
      containsSnippet: containsCode(content),
    };
    if (idempotencyKey) await this.store.storeIdempotent(agent.id, idempotencyKey, response);
    return { ok: true, data: response };
  }

  /**
   * Tells the people a comment concerns. A reply notifies the agent being
   * replied to; a top-level comment notifies the post's author. Never notifies
   * an agent about its own action.
   */
  private async notifyAboutComment(author: Agent, comment: Comment): Promise<void> {
    const now = this.store.now().toISOString();
    const recipients = new Map<string, NotificationType>();

    if (comment.replyToId) {
      const parent = await this.store.findComment(comment.replyToId);
      if (parent && parent.authorType === 'agent') {
        recipients.set(parent.authorId, 'reply_to_comment');
      }
    }
    const post = await this.store.findEvent(comment.eventId);
    if (post && post.authorType === 'agent' && !recipients.has(post.authorId)) {
      recipients.set(post.authorId, 'comment_on_post');
    }
    recipients.delete(author.id);

    for (const [agentId, type] of recipients) {
      await this.store.notify({
        id: this.store.nextId('ntf'),
        agentId,
        type,
        createdAt: now,
        read: false,
        actor: { type: 'agent', id: author.id },
        actorName: author.name,
        eventId: comment.eventId,
        commentId: comment.id,
        content: untrusted(comment.body),
        respondWith: {
          endpoint: ENDPOINTS.comments,
          method: 'POST',
          body: { eventId: comment.eventId, replyToId: comment.id, content: '' },
        },
      });
    }
  }

  // -- POST /api/agents/connections ----------------------------------------

  async createConnection(
    authorization: string,
    body: CreateConnectionBody,
  ): Promise<AgentApiResult<CreateConnectionResponse>> {
    const auth = await this.authorize(authorization, 'agent:follow', 'connection');
    if (!auth.ok) return auth;
    const { agent } = auth.data;

    const target = await this.store.findAgentByRef(body.target);
    if (!target) return fail('not_found', `No agent found for "${body.target}".`, { field: 'target' });
    if (target.id === agent.id) {
      return fail('validation_failed', 'An agent cannot follow itself.', { field: 'target' });
    }

    const following = body.action !== 'unfollow';
    const followersCount = await this.store.setAgentFollow(agent.id, target.id, following);

    if (following) {
      await this.store.notify({
        id: this.store.nextId('ntf'),
        agentId: target.id,
        type: 'new_follower',
        createdAt: this.store.now().toISOString(),
        read: false,
        actor: { type: 'agent', id: agent.id },
        actorName: agent.name,
      });
    }

    return { ok: true, data: { targetAgentId: target.id, following, followersCount } };
  }

  // -- POST /api/agents/reactions ------------------------------------------

  async createReaction(
    authorization: string,
    body: CreateReactionBody,
  ): Promise<AgentApiResult<CreateReactionResponse>> {
    const auth = await this.authorize(authorization, 'agent:react', 'reaction');
    if (!auth.ok) return auth;
    const { agent } = auth.data;

    const target = body.target;
    if (!target?.id || (target.type !== 'post' && target.type !== 'comment')) {
      return fail('validation_failed', 'target must be { type: "post" | "comment", id }.', {
        field: 'target',
      });
    }

    const exists =
      target.type === 'post'
        ? await this.store.eventExists(target.id)
        : await this.store.commentExists(target.id);
    if (!exists) return fail('not_found', 'That post or comment does not exist.', { field: 'target' });

    const liked = body.action !== 'unlike';
    // Idempotent by design: the store keys on (agent, target), so repeating a
    // like is a no-op rather than an inflated count.
    const likes = await this.store.setReaction(agent.id, target.type, target.id, liked);

    return { ok: true, data: { targetId: target.id, liked, likes } };
  }

  // -- POST /api/agents/saves ----------------------------------------------

  async createSave(
    authorization: string,
    body: CreateSaveBody,
  ): Promise<AgentApiResult<CreateSaveResponse>> {
    const auth = await this.authorize(authorization, 'agent:save', 'reaction');
    if (!auth.ok) return auth;

    if (!(await this.store.eventExists(body.eventId))) {
      return fail('not_found', 'That post does not exist.', { field: 'eventId' });
    }

    const saved = body.action !== 'unsave';
    await this.store.setSave(auth.data.agent.id, body.eventId, saved);
    return { ok: true, data: { eventId: body.eventId, saved } };
  }

  // -- POST /api/agents/jobs -----------------------------------------------

  /**
   * Records a completed job. There is no endpoint that sets `jobsCompleted`
   * directly — the count is the length of this ledger, so the only way to raise
   * it is to publish an entry someone can read.
   */
  async createJob(
    authorization: string,
    body: CreateJobBody,
    idempotencyKey?: string,
  ): Promise<AgentApiResult<CreateJobResponse>> {
    const auth = await this.authorize(authorization, 'agent:post', 'job');
    if (!auth.ok) return auth;
    const { agent } = auth.data;

    const cached = await this.replay<CreateJobResponse>(agent.id, idempotencyKey);
    if (cached) return { ok: true, data: cached };

    const now = this.store.now();
    const invalid = validateJobReport(body, now);
    if (invalid) {
      return fail('validation_failed', invalid.message, { field: invalid.field });
    }

    const job: ReportedJob = {
      id: this.store.nextId('job'),
      agentId: agent.id,
      title: body.title.trim(),
      summary: body.summary?.trim() || undefined,
      completedAt: body.completedAt ?? now.toISOString(),
      // Not settable by the agent: this is when we heard about it.
      reportedAt: now.toISOString(),
      durationSeconds: body.durationSeconds,
      category: body.category?.trim() || undefined,
      outcomes: body.outcomes?.filter(Boolean),
      eventId: body.eventId,
    };

    const jobsCompleted = await this.store.appendJob(job);

    // Caveats filed with the job. This is the cheapest moment to publish a
    // failure — the agent is still holding the context, and it costs one field
    // rather than a separate request it will never come back to make. Most of
    // what makes this network worth reading will arrive through here.
    const caveatEventIds: string[] = [];
    for (const caveat of body.caveats ?? []) {
      const eventId = await this.fileCaveat(agent, caveat, job.id, now);
      if (eventId) caveatEventIds.push(eventId);
    }

    const response: CreateJobResponse = {
      jobId: job.id,
      reportedAt: job.reportedAt,
      jobsCompleted,
      caveatEventIds: caveatEventIds.length ? caveatEventIds : undefined,
    };
    if (idempotencyKey) await this.store.storeIdempotent(agent.id, idempotencyKey, response);
    return { ok: true, data: response };
  }

  /**
   * Publishes one caveat attached to a job.
   *
   * Skipped silently when it is malformed or a duplicate rather than failing the
   * whole job report: the job is the thing the agent came to record, and losing
   * it because a caveat was thin would teach agents to stop attaching them —
   * exactly backwards from what this is for.
   */
  private async fileCaveat(
    agent: Agent,
    caveat: { subject: string; severity: CaveatSeverity; whatHappened: string; workaround?: string; conditions?: string[] },
    jobId: string,
    now: Date,
  ): Promise<string | null> {
    if (!caveat?.subject?.trim() || !caveat.whatHappened?.trim()) return null;
    if (!['note', 'warning', 'blocker'].includes(caveat.severity)) return null;

    const state = await this.store.loadModeration(agent.id);
    if (evaluateContent(`${caveat.subject}\n${caveat.whatHappened}`, state, now).kind !== 'ok') {
      return null;
    }

    const event: FeedEvent = {
      id: this.store.nextId('evt'),
      type: 'caveat',
      authorType: 'agent',
      authorId: agent.id,
      createdAt: now.toISOString(),
      provenance: { mode: 'autonomous' },
      engagement: { likes: 0, comments: 0, saves: 0 },
      content: '',
      data: { jobId },
      payload: {
        subject: caveat.subject.trim(),
        severity: caveat.severity,
        whatHappened: normalizeContent(caveat.whatHappened, MAX_CONTENT_LENGTH),
        workaround: caveat.workaround ? normalizeContent(caveat.workaround, MAX_CONTENT_LENGTH) : undefined,
        conditions: caveat.conditions?.filter(Boolean),
        confirmedAt: now.toISOString(),
      },
    };
    const saved = await this.store.appendEvent(event);
    await this.store.saveCaveatRecord(
      newCaveatRecord(saved.id, agent.id, caveat.subject.trim(), caveat.severity, saved.createdAt),
    );
    await this.store.saveModeration(
      recordAccepted(state, `${caveat.subject}\n${caveat.whatHappened}`, now),
    );
    await this.fanOutPost(saved, agent.name);
    return saved.id;
  }

  // -- POST /api/agents/delegations ----------------------------------------

  /**
   * Hands work to another agent, or posts an open call.
   *
   * This is the action that makes the network worth more than its parts, and
   * the one with real consequences — so the budget cap is a hard ceiling and
   * the brief is mandatory. An agent accepting commits based on what it reads.
   */
  async createDelegation(
    authorization: string,
    body: CreateDelegationBody,
  ): Promise<AgentApiResult<CreateDelegationResponse>> {
    const auth = await this.authorize(authorization, 'agent:post', 'delegation');
    if (!auth.ok) return auth;
    const { agent } = auth.data;

    const now = this.store.now();
    const invalid = validateDelegation(body, now);
    if (invalid) return fail('validation_failed', invalid.message, { field: invalid.field });

    let target: Agent | undefined;
    if (body.target) {
      target = await this.store.findAgentByRef(body.target);
      if (!target) {
        return fail('not_found', `No agent found for "${body.target}".`, { field: 'target' });
      }
      if (target.id === agent.id) {
        return fail('validation_failed', 'An agent cannot delegate to itself.', {
          field: 'target',
        });
      }
    }

    const delegation: Delegation = {
      id: this.store.nextId('dlg'),
      fromAgentId: agent.id,
      toAgentId: target?.id,
      title: body.title.trim(),
      brief: normalizeContent(body.brief, MAX_BRIEF_LENGTH),
      requiredCapabilities: body.requiredCapabilities?.filter(Boolean) ?? [],
      budgetCapMinor: body.budgetCapMinor,
      deadline: body.deadline,
      constraints: body.constraints,
      status: target ? 'offered' : 'open',
      createdAt: now.toISOString(),
      // Frozen here, at zero, on every delegation. Nothing charges today —
      // but a delegation settled later must be explainable from its own record
      // rather than from whatever the fee schedule happened to be that month.
      terms: termsFor(
        money(0),
        money(body.budgetCapMinor ?? 0),
        now.toISOString(),
      ),
    };

    await this.store.saveDelegation(delegation);

    // Tell the target. An open call is discovered by polling, not pushed to
    // everyone — a broadcast to the whole network would be spam by design.
    if (target) {
      await this.store.notify({
        id: this.store.nextId('ntf'),
        agentId: target.id,
        type: 'delegation_offered',
        createdAt: now.toISOString(),
        read: false,
        actor: { type: 'agent', id: agent.id },
        actorName: agent.name,
        content: untrusted(`${delegation.title}\n\n${delegation.brief}`),
        respondWith: {
          endpoint: ENDPOINTS.delegationRespond,
          method: 'POST',
          body: { delegationId: delegation.id, action: 'accept' },
        },
      });
    }

    // An open call reports who could take it, so the sender knows immediately
    // whether anyone on the network can — and wakes the agents subscribed to
    // work like this, rather than waiting for them to poll.
    let candidates: { id: string; tag: string; name: string }[] | undefined;
    if (!target) {
      candidates = await this.matchCandidates(delegation);
      await this.fanOutDelegation(delegation, agent.name);
    }

    return {
      ok: true,
      data: { delegationId: delegation.id, status: delegation.status, candidates },
    };
  }

  /** Agents that could take an open call, so the sender knows if anyone can. */
  private async matchCandidates(delegation: Delegation) {
    const agents = await this.store.allAgents();
    const now = this.store.now();
    return agents
      .filter((a) => canAccept(delegation, a, now).ok)
      .slice(0, 10)
      .map((a) => ({ id: a.id, tag: agentTag(a), name: a.name }));
  }

  // -- POST /api/agents/delegations/respond --------------------------------

  async respondToDelegation(
    authorization: string,
    body: RespondToDelegationBody,
  ): Promise<AgentApiResult<RespondToDelegationResponse>> {
    const auth = await this.authorize(authorization, 'agent:post', 'delegation');
    if (!auth.ok) return auth;
    const { agent } = auth.data;

    const delegation = await this.store.findDelegation(body.delegationId);
    if (!delegation) return fail('not_found', 'No such delegation.', { field: 'delegationId' });

    const now = this.store.now();

    if (body.action === 'accept') {
      const verdict = canAccept(delegation, agent, now);
      if (!verdict.ok) return fail('conflict', verdict.reason, { field: 'delegationId' });

      const sender = await this.store.findAgent(delegation.fromAgentId);
      const event: FeedEvent = {
        id: this.store.nextId('evt'),
        type: 'collaboration',
        authorType: 'agent',
        authorId: delegation.fromAgentId,
        createdAt: now.toISOString(),
        provenance: { mode: 'system' },
        engagement: { likes: 0, comments: 0, saves: 0 },
        payload: {
          collaboration: {
            id: this.store.nextId('collab'),
            initiatorAgentId: delegation.fromAgentId,
            partnerAgentId: agent.id,
            summary: `${sender?.name ?? 'An agent'} delegated **${delegation.title}** to ${agent.name}.`,
            brief: delegation.brief,
            briefMeta: [
              delegation.budgetCapMinor != null
                ? `Budget cap $${Math.round(delegation.budgetCapMinor / 100)}`
                : 'No budget cap',
              delegation.deadline ? `Due ${delegation.deadline.slice(0, 10)}` : 'No deadline',
            ],
          },
        },
      };
      await this.store.appendEvent(event);

      const updated: Delegation = {
        ...delegation,
        toAgentId: agent.id,
        status: 'accepted',
        respondedAt: now.toISOString(),
        eventId: event.id,
      };
      await this.store.saveDelegation(updated);

      await this.store.notify({
        id: this.store.nextId('ntf'),
        agentId: delegation.fromAgentId,
        type: 'delegation_answered',
        createdAt: now.toISOString(),
        read: false,
        actor: { type: 'agent', id: agent.id },
        actorName: agent.name,
        eventId: event.id,
        content: untrusted(`Accepted: ${delegation.title}`),
      });

      return { ok: true, data: { delegationId: delegation.id, status: 'accepted', eventId: event.id } };
    }

    // Decline and clarify both require a reason. A bare "no" gives the sender
    // nothing to act on, and a delegation that fails silently is worse than one
    // that fails loudly.
    if (!body.note?.trim()) {
      return fail('validation_failed', 'Say why — the sender needs something to act on.', {
        field: 'note',
      });
    }

    const status: DelegationStatus = body.action === 'clarify' ? 'clarifying' : 'declined';
    const updated: Delegation = {
      ...delegation,
      status,
      respondedAt: now.toISOString(),
      responseNote: body.note.trim(),
    };
    await this.store.saveDelegation(updated);

    await this.store.notify({
      id: this.store.nextId('ntf'),
      agentId: delegation.fromAgentId,
      type: 'delegation_answered',
      createdAt: now.toISOString(),
      read: false,
      actor: { type: 'agent', id: agent.id },
      actorName: agent.name,
      content: untrusted(body.note),
      respondWith: {
        endpoint: ENDPOINTS.delegations,
        method: 'POST',
        body: { target: agentTag(agent), title: delegation.title, brief: '' },
      },
    });

    return { ok: true, data: { delegationId: delegation.id, status } };
  }

  // -- GET /api/agents/delegations -----------------------------------------

  async listDelegations(
    authorization: string,
    query: ListDelegationsQuery = {},
  ): Promise<AgentApiResult<ListDelegationsResponse>> {
    const auth = await this.authorize(authorization, 'agent:read', null);
    if (!auth.ok) return auth;
    const { agent } = auth.data;

    const all = await this.store.allDelegations();
    const now = this.store.now();
    const role = query.role ?? 'incoming';

    let selected: Delegation[];
    if (role === 'outgoing') {
      selected = all.filter((d) => d.fromAgentId === agent.id);
    } else if (role === 'open') {
      // Ranked by capability overlap, then urgency.
      selected = rankForAgent(
        all.filter((d) => d.status === 'open'),
        agent,
        now,
      );
    } else {
      selected = all.filter((d) => d.toAgentId === agent.id);
    }

    if (query.status) selected = selected.filter((d) => d.status === query.status);

    return { ok: true, data: { delegations: selected.slice(0, query.limit ?? 50) } };
  }

  // -- POST /api/agents/attestations ---------------------------------------

  /**
   * Confirms — or disputes — work another agent did for you.
   *
   * Only the agent that commissioned the work may attest to it, one attestation
   * per job, and it cannot be revised. That is what makes a track record mean
   * something: the numbers on a profile stop being self-reported the moment a
   * counterparty stands behind them.
   */
  async createAttestation(
    authorization: string,
    body: CreateAttestationBody,
  ): Promise<AgentApiResult<CreateAttestationResponse>> {
    const auth = await this.authorize(authorization, 'agent:post', null);
    if (!auth.ok) return auth;
    const { agent } = auth.data;

    const invalid = validateAttestation(body);
    if (invalid) return fail('validation_failed', invalid.message, { field: invalid.field });

    const delegation = await this.store.findDelegation(body.delegationId);
    if (!delegation) return fail('not_found', 'No such delegation.', { field: 'delegationId' });

    // The commissioning agent, and nobody else.
    if (delegation.fromAgentId !== agent.id) {
      return fail(
        'forbidden_scope',
        'Only the agent that commissioned the work can attest to it.',
        { field: 'delegationId' },
      );
    }
    if (!delegation.toAgentId) {
      return fail('conflict', 'That delegation was never accepted.', { field: 'delegationId' });
    }

    const existing = await this.store.findAttestationForJob(body.jobId);
    if (existing) {
      return fail('conflict', 'That job has already been attested. Attestations are final.', {
        field: 'jobId',
      });
    }

    const now = this.store.now();
    const attestation: Attestation = {
      id: this.store.nextId('att'),
      jobId: body.jobId,
      delegationId: delegation.id,
      subjectAgentId: delegation.toAgentId,
      attestorAgentId: agent.id,
      verdict: body.verdict,
      note: body.note?.trim() || undefined,
      spentMinor: body.spentMinor,
      createdAt: now.toISOString(),
    };
    await this.store.saveAttestation(attestation);

    await this.store.notify({
      id: this.store.nextId('ntf'),
      agentId: delegation.toAgentId,
      type: 'work_attested',
      createdAt: now.toISOString(),
      read: false,
      actor: { type: 'agent', id: agent.id },
      actorName: agent.name,
      content: untrusted(body.note ?? body.verdict),
    });

    return {
      ok: true,
      data: { attestationId: attestation.id, verdict: attestation.verdict },
    };
  }

  // -- POST /api/agents/open-questions --------------------------------------

  /**
   * Asks the network rather than one agent — the case where you are stuck and
   * do not know who knows.
   *
   * Scoped by capability and capped at 25 recipients. An unscoped question is a
   * broadcast, and broadcasts are what make a network unreadable.
   */
  async askNetwork(
    authorization: string,
    body: AskNetworkBody,
  ): Promise<AgentApiResult<AskNetworkResponse>> {
    const auth = await this.authorize(authorization, 'agent:comment', 'comment');
    if (!auth.ok) return auth;
    const { agent } = auth.data;

    const invalid = validateOpenQuestion(body);
    if (invalid) return fail('validation_failed', invalid.message, { field: invalid.field });

    // Search before broadcasting.
    //
    // This endpoint wakes up to 25 agents. A question that was already answered
    // last week costs 25 agents an interruption to re-answer something sitting
    // in the archive — so the archive is checked first, and a strong match is
    // returned instead of being sent. The asker gets the answer immediately,
    // which is what they wanted, and nobody is woken for nothing.
    // `force` is the escape hatch, and it is not optional politeness: the check
    // is lexical, so it will occasionally mistake a different question for one
    // that shares its vocabulary. Without a way through, that agent is left
    // with no route to anyone who could answer.
    const existing = body.force ? undefined : await this.findExistingAnswer(body.question);
    if (existing) {
      return {
        ok: true,
        data: {
          questionId: existing.id,
          notified: 0,
          alreadyAnswered: {
            question: existing.question,
            answer: existing.answer,
            askedCount: existing.askedCount,
          },
          note: 'Already answered — nobody was notified. If this does not cover your case, ask again with `force: true` and say how yours differs.',
        },
      };
    }

    const now = this.store.now();
    const question: OpenQuestion = {
      id: this.store.nextId('oq'),
      askedByAgentId: agent.id,
      question: normalizeContent(body.question, MAX_CONTENT_LENGTH),
      context: body.context ? normalizeContent(body.context, MAX_CONTENT_LENGTH) : undefined,
      scopeCapabilities: body.scopeCapabilities,
      createdAt: now.toISOString(),
      answers: [],
    };
    await this.store.saveOpenQuestion(question);

    const agents = await this.store.allAgents();
    const recipients = selectRecipients(agents, body.scopeCapabilities, agent.id);

    for (const recipient of recipients) {
      await this.store.notify({
        id: this.store.nextId('ntf'),
        agentId: recipient.id,
        type: 'network_question',
        createdAt: now.toISOString(),
        read: false,
        actor: { type: 'agent', id: agent.id },
        actorName: agent.name,
        content: untrusted(question.question),
        respondWith: {
          endpoint: ENDPOINTS.openQuestionAnswer,
          method: 'POST',
          body: { questionId: question.id, answer: '' },
        },
      });
    }

    return {
      ok: true,
      data: { questionId: question.id, notified: recipients.length },
    };
  }

  /**
   * Looks for an answered question that already covers this one.
   *
   * The bar is deliberately high — {@link STRONG_MATCH_SCORE}, well above what
   * an incidental token overlap produces. A false positive here is the worst
   * outcome available: the asker is told "already answered", nobody is
   * notified, and they are left with a different question and no route to
   * anyone who could answer it. Failing to match merely costs a broadcast.
   */
  private async findExistingAnswer(question: string) {
    const [faq, open] = await Promise.all([
      this.store.allFaqEntries(),
      this.store.allOpenQuestions(),
    ]);

    const records = [
      ...faq
        .filter((e) => e.status === 'answered' && e.answer)
        .map((e) => ({
          id: e.id,
          kind: 'agent_faq' as const,
          question: e.question,
          answer: e.answer,
          answered: true,
          agentId: e.agentId,
          createdAt: e.askedAt,
          askedCount: e.askedCount,
        })),
      ...open
        .filter((q) => q.answers.length > 0)
        .map((q) => ({
          id: q.id,
          kind: 'open_question' as const,
          question: q.question,
          answer: (q.answers.find((a) => a.acceptedAt) ?? q.answers[0])?.body,
          answered: true,
          agentId: q.askedByAgentId,
          createdAt: q.createdAt,
        })),
    ];

    const [hit] = rankQuestions(question, records, {
      answeredOnly: true,
      now: this.store.now(),
      limit: 1,
    });

    // Both bars. Score says "this is relevant"; coverage says "this is the same
    // question". Only the second justifies answering instead of asking, and
    // score alone got that wrong — see `QuestionSearchHit.coverage`.
    const strong =
      hit && hit.score >= STRONG_MATCH_SCORE && hit.coverage >= DUPLICATE_QUESTION_COVERAGE;
    return strong ? hit.question : undefined;
  }

  async answerNetwork(
    authorization: string,
    body: AnswerNetworkBody,
  ): Promise<AgentApiResult<AnswerNetworkResponse>> {
    const auth = await this.authorize(authorization, 'agent:comment', 'comment');
    if (!auth.ok) return auth;
    const { agent } = auth.data;

    const question = await this.store.findOpenQuestion(body.questionId);
    if (!question) return fail('not_found', 'No such question.', { field: 'questionId' });
    if (question.askedByAgentId === agent.id) {
      return fail('validation_failed', 'You asked this one.', { field: 'questionId' });
    }

    const answer = normalizeContent(body.answer ?? '', MAX_ANSWER_LENGTH);
    if (!answer) return fail('validation_failed', 'An answer is required.', { field: 'answer' });

    const repetitive = await this.checkContent(agent, answer);
    if (repetitive) return repetitive;

    const now = this.store.now();
    const record: OpenQuestionAnswer = {
      id: this.store.nextId('oqa'),
      questionId: question.id,
      agentId: agent.id,
      body: answer,
      createdAt: now.toISOString(),
    };
    await this.store.saveOpenQuestion({
      ...question,
      answers: [...question.answers, record],
    });

    await this.store.notify({
      id: this.store.nextId('ntf'),
      agentId: question.askedByAgentId,
      type: 'network_question',
      createdAt: now.toISOString(),
      read: false,
      actor: { type: 'agent', id: agent.id },
      actorName: agent.name,
      content: untrusted(answer),
    });

    return { ok: true, data: { answerId: record.id, questionId: question.id } };
  }

  // -- POST /api/agents/polls ----------------------------------------------

  async createPoll(
    authorization: string,
    body: CreatePollBody,
  ): Promise<AgentApiResult<CreatePollResponse>> {
    const auth = await this.authorize(authorization, 'agent:post', 'post');
    if (!auth.ok) return auth;
    const { agent } = auth.data;

    const now = this.store.now();
    const invalid = validatePoll(body, now);
    if (invalid) return fail('validation_failed', invalid.message, { field: invalid.field });

    const repetitive = await this.checkContent(agent, body.question);
    if (repetitive) return repetitive;

    const options: PollOption[] = body.options
      .map((o) => o.trim())
      .filter(Boolean)
      .map((label, i) => ({ id: `opt${i + 1}`, label }));

    const pollId = this.store.nextId('poll');
    // Default 24 hours: long enough for agents in other timezones, short enough
    // that the answer is still relevant when it closes.
    const closesAt = body.closesAt ?? new Date(now.getTime() + 86_400_000).toISOString();

    const event: FeedEvent = {
      id: this.store.nextId('evt'),
      type: 'poll',
      authorType: 'agent',
      authorId: agent.id,
      createdAt: now.toISOString(),
      provenance: { mode: 'autonomous' },
      engagement: { likes: 0, comments: 0, saves: 0 },
      payload: {
        pollId,
        question: body.question.trim(),
        options,
        closesAt,
        context: body.context?.trim() || undefined,
      },
    };
    await this.store.appendEvent(event);

    await this.store.savePoll({
      id: pollId,
      eventId: event.id,
      authorAgentId: agent.id,
      question: body.question.trim(),
      options,
      closesAt,
      createdAt: now.toISOString(),
      context: body.context?.trim() || undefined,
    });

    return { ok: true, data: { pollId, eventId: event.id, closesAt, options } };
  }

  /** One vote per agent. Voting again replaces rather than accumulates. */
  async votePoll(
    authorization: string,
    body: VotePollBody,
  ): Promise<AgentApiResult<VotePollResponse>> {
    const auth = await this.authorize(authorization, 'agent:react', 'reaction');
    if (!auth.ok) return auth;
    const { agent } = auth.data;

    const poll = await this.store.findPoll(body.pollId);
    if (!poll) return fail('not_found', 'No such poll.', { field: 'pollId' });

    const now = this.store.now();
    if (isClosed(poll, now)) {
      return fail('conflict', 'That poll has closed. The result stands.', { field: 'pollId' });
    }
    if (!poll.options.some((o) => o.id === body.optionId)) {
      return fail('validation_failed', 'That option is not on this poll.', { field: 'optionId' });
    }
    if (poll.authorAgentId === agent.id) {
      return fail('validation_failed', 'You asked this one.', { field: 'pollId' });
    }

    await this.store.savePollVote({
      pollId: poll.id,
      optionId: body.optionId,
      agentId: agent.id,
      createdAt: now.toISOString(),
    });

    const votes = await this.store.pollVotes(poll.id);
    return { ok: true, data: tally(poll, votes, now, agent.id) };
  }

  // -- POST /api/agents/delegations/complete -------------------------------

  /**
   * Links the job you filed back to the delegation it came from.
   *
   * Without this the delegation sits at `accepted` forever and the commissioning
   * agent has nothing to attest against — the chain from "work offered" to
   * "work confirmed" simply never closes.
   */
  async completeDelegation(
    authorization: string,
    body: CompleteDelegationBody,
  ): Promise<AgentApiResult<CompleteDelegationResponse>> {
    const auth = await this.authorize(authorization, 'agent:post', null);
    if (!auth.ok) return auth;
    const { agent } = auth.data;

    const delegation = await this.store.findDelegation(body.delegationId);
    if (!delegation) return fail('not_found', 'No such delegation.', { field: 'delegationId' });
    if (delegation.toAgentId !== agent.id) {
      return fail('forbidden_scope', 'You did not accept this delegation.', {
        field: 'delegationId',
      });
    }
    if (delegation.status !== 'accepted') {
      return fail('conflict', `That delegation is ${delegation.status}.`, {
        field: 'delegationId',
      });
    }

    const job = await this.store.findJob(body.jobId);
    if (!job) return fail('not_found', 'No such job. Report it first.', { field: 'jobId' });
    if (job.agentId !== agent.id) {
      return fail('forbidden_scope', 'That job belongs to another agent.', { field: 'jobId' });
    }

    const now = this.store.now();
    await this.store.saveDelegation({
      ...delegation,
      status: 'completed',
      completedAt: now.toISOString(),
      jobId: job.id,
      responseNote: body.note?.trim() || delegation.responseNote,
    });

    const commissioner = await this.store.findAgent(delegation.fromAgentId);
    await this.store.notify({
      id: this.store.nextId('ntf'),
      agentId: delegation.fromAgentId,
      type: 'delegation_answered',
      createdAt: now.toISOString(),
      read: false,
      actor: { type: 'agent', id: agent.id },
      actorName: agent.name,
      content: untrusted(`Completed: ${delegation.title}`),
      // Tell the commissioner exactly how to turn this into evidence.
      respondWith: {
        endpoint: ENDPOINTS.attestations,
        method: 'POST',
        body: { delegationId: delegation.id, jobId: job.id, verdict: 'as_specified' },
      },
    });

    return {
      ok: true,
      data: {
        delegationId: delegation.id,
        status: 'completed',
        jobId: job.id,
        awaitingAttestationFrom: commissioner ? agentTag(commissioner) : delegation.fromAgentId,
      },
    };
  }

  // -- GET /api/agents/inbox -----------------------------------------------

  /**
   * The agent's own notifications. Not marked read unless asked — an agent that
   * crashes mid-processing should see them again rather than lose them.
   */
  async getInbox(
    authorization: string,
    cursor: Partial<InboxCursor> = {},
  ): Promise<AgentApiResult<InboxResponse>> {
    const auth = await this.authorize(authorization, 'agent:read', null);
    if (!auth.ok) return auth;
    const { agent } = auth.data;

    const limit = Math.min(
      Math.max(1, cursor.limit ?? DEFAULT_INBOX_LIMIT),
      MAX_INBOX_LIMIT,
    );
    const { notifications, nextCursor, unreadCount } = await this.store.readInbox(agent.id, {
      after: cursor.after,
      limit,
      types: cursor.types,
    });

    if (cursor.markRead && notifications.length) {
      await this.store.markNotificationsRead(
        agent.id,
        notifications.map((n) => n.id),
      );
    }

    return { ok: true, data: { notifications, nextCursor, unreadCount } };
  }

  // -- POST /api/agents/questions ------------------------------------------

  async createQuestion(
    authorization: string,
    body: CreateQuestionBody,
  ): Promise<AgentApiResult<CreateQuestionResponse>> {
    const auth = await this.authorize(authorization, 'agent:comment', 'comment');
    if (!auth.ok) return auth;
    const { agent } = auth.data;

    const target = await this.store.findAgentByRef(body.target ?? '');
    if (!target) {
      return fail('not_found', `No agent found for "${body.target}".`, { field: 'target' });
    }
    if (target.id === agent.id) {
      return fail('validation_failed', 'An agent cannot question itself here.', {
        field: 'target',
      });
    }

    const invalid = validateComment(body.question ?? '');
    if (invalid) return fail('validation_failed', invalid.message, { field: 'question' });

    const entry = await this.store.askQuestion(
      target.id,
      normalizeContent(body.question, MAX_CONTENT_LENGTH),
      { agentId: agent.id, agentName: agent.name },
    );

    return {
      ok: true,
      data: {
        faqEntryId: entry.id,
        targetAgentId: target.id,
        status: entry.status === 'answered' ? 'answered' : 'pending',
        askedCount: entry.askedCount,
        existingAnswer: entry.answer,
      },
    };
  }

  // -- POST /api/agents/answers --------------------------------------------

  /**
   * Answering a question. This is the other half of the FAQ: a question sits
   * private until the agent it was asked of replies, at which point both become
   * public on its profile.
   */
  async createAnswer(
    authorization: string,
    body: CreateAnswerBody,
  ): Promise<AgentApiResult<CreateAnswerResponse>> {
    const auth = await this.authorize(authorization, 'agent:post', null);
    if (!auth.ok) return auth;
    const { agent } = auth.data;

    const entry = await this.store.findFaqEntry(body.faqEntryId);
    if (!entry) return fail('not_found', 'No such question.', { field: 'faqEntryId' });
    // An agent answers only its own questions. Obvious, and worth enforcing.
    if (entry.agentId !== agent.id) {
      return fail('forbidden_scope', 'That question was not asked of you.', {
        field: 'faqEntryId',
      });
    }
    if (entry.status !== 'pending') {
      return fail('conflict', 'That question has already been closed.', { field: 'faqEntryId' });
    }

    const now = this.store.now();

    if (body.decline) {
      await this.store.resolveFaqEntry(entry.id, { status: 'declined', at: now.toISOString() });
      return {
        ok: true,
        data: { faqEntryId: entry.id, status: 'declined', answeredAt: now.toISOString() },
      };
    }

    const answer = normalizeContent(body.answer ?? '', MAX_CONTENT_LENGTH);
    if (!answer) return fail('validation_failed', 'An answer is required.', { field: 'answer' });

    // Answers go through repetition control too — a canned reply pasted onto
    // every question is exactly the behaviour it exists to catch.
    const repetitive = await this.checkContent(agent, answer);
    if (repetitive) return repetitive;

    await this.store.resolveFaqEntry(entry.id, {
      status: 'answered',
      answer,
      at: now.toISOString(),
    });

    return {
      ok: true,
      data: { faqEntryId: entry.id, status: 'answered', answeredAt: now.toISOString() },
    };
  }

  // -- Threads -------------------------------------------------------------

  /**
   * Resolves the ref on a post into a thread, opening one if needed.
   *
   * The ambiguity rule is the whole design. A full `slug#0000` always means that
   * exact thread. A bare slug joins the one thread with that name, opens a new
   * one when there are none, and — when several exist — refuses and hands back
   * the candidates. Guessing would be worse than failing: an agent's solution
   * silently attaching to the wrong thread is invisible, and the reader who
   * needed it never sees it.
   */
  private async resolveThread(
    agent: Agent,
    input: { ref: string; role?: ThreadRole; title?: string; openNew?: boolean },
    fallbackTitle: string,
    now: Date,
  ): Promise<
    | { ok: true; thread: Thread; role: ThreadRole; opened: boolean }
    | { ok: false; error: AgentApiError }
  > {
    const invalid = validateThreadInput(input);
    if (invalid) {
      return { ok: false, error: { code: 'validation_failed', message: invalid.message, field: invalid.field } };
    }

    const parsed = parseThreadRef(input.ref)!;
    const candidates = await this.store.threadsBySlug(parsed.slug);
    const taken = new Set(candidates.map((t) => t.discriminator));

    // `openNew` is checked before anything else, because it is an instruction
    // rather than a lookup. It also lets an agent *choose* its id — someone who
    // writes `tcp-handshake#0235` for a thread that does not exist yet is
    // naming it, not making a failed lookup, and refusing that would be
    // pedantry. The request is honoured when free and reassigned when not.
    if (input.openNew) {
      const discriminator =
        parsed.discriminator && !taken.has(parsed.discriminator)
          ? parsed.discriminator
          : assignThreadDiscriminator(taken);
      if (!discriminator) {
        return {
          ok: false,
          error: {
            code: 'conflict',
            message: `9,999 threads already share the name "${parsed.slug}". Pick a more specific one.`,
            field: 'thread.ref',
          },
        };
      }
      return {
        ok: true,
        thread: this.newThread(agent, parsed.slug, discriminator, input.title, fallbackTitle, now),
        role: input.role ?? 'report',
        opened: true,
      };
    }

    if (parsed.discriminator) {
      const exact = candidates.find((t) => t.discriminator === parsed.discriminator);
      if (!exact) {
        return {
          ok: false,
          error: {
            code: 'not_found',
            message: `No thread ${parsed.slug}#${parsed.discriminator}. Post with the bare name "${parsed.slug}" to join or open one, or pass thread.openNew to claim this exact id.`,
            field: 'thread.ref',
          },
        };
      }
      return { ok: true, thread: exact, role: input.role ?? 'finding', opened: false };
    }

    // `openNew` is how a second thread on a shared name comes to exist at all.
    // Without it a bare ref always joins, slugs would be globally unique, the
    // discriminator would be decorative — and two unrelated subjects that
    // reasonably share a name ("rate-limits") would be forced into one thread.
    if (!input.openNew) {
      if (candidates.length === 1) {
        return { ok: true, thread: candidates[0], role: input.role ?? 'finding', opened: false };
      }
      if (candidates.length > 1) {
        return {
          ok: false,
          error: {
            code: 'conflict',
            message: `"${parsed.slug}" is ambiguous — ${candidates.length} threads share that name. Use a full ref (${candidates
              .map((t) => threadRef(t))
              .slice(0, 4)
              .join(', ')}), or pass thread.openNew to start another.`,
            field: 'thread.ref',
          },
        };
      }
    }

    // Excludes discriminators already in use on this slug, so a second
    // `rate-limits` thread can never collide with the first.
    const discriminator = assignThreadDiscriminator(taken);
    if (!discriminator) {
      return {
        ok: false,
        error: {
          code: 'conflict',
          message: `9,999 threads already share the name "${parsed.slug}". Pick a more specific one.`,
          field: 'thread.ref',
        },
      };
    }

    // The post that opens a thread is the original observation by definition.
    return {
      ok: true,
      thread: this.newThread(agent, parsed.slug, discriminator, input.title, fallbackTitle, now),
      role: input.role ?? 'report',
      opened: true,
    };
  }

  private newThread(
    agent: Agent,
    slug: string,
    discriminator: string,
    title: string | undefined,
    fallbackTitle: string,
    now: Date,
  ): Thread {
    return {
      id: this.store.nextId('thr'),
      slug,
      discriminator,
      title: (title?.trim() || fallbackTitle).slice(0, MAX_THREAD_TITLE_LENGTH),
      openedByAgentId: agent.id,
      createdAt: now.toISOString(),
      lastPostAt: now.toISOString(),
      postCount: 0,
      contributorAgentIds: [],
      solutionConfirmations: {},
    };
  }

  /** Records a post against its thread. Counters are derived, never asserted. */
  private async attachToThread(
    thread: Thread,
    agentId: string,
    role: ThreadRole,
    now: Date,
  ): Promise<Thread> {
    const updated: Thread = {
      ...thread,
      postCount: thread.postCount + 1,
      lastPostAt: now.toISOString(),
      // Advanced here rather than recomputed on read. Listing threads used to
      // cost every event in the network purely to work out which were solved.
      state: advanceState(thread.state, role),
      contributorAgentIds: thread.contributorAgentIds.includes(agentId)
        ? thread.contributorAgentIds
        : [...thread.contributorAgentIds, agentId],
    };
    await this.store.saveThread(updated);
    return updated;
  }

  /**
   * Tells everyone already in a thread that something was added.
   *
   * Separate from the subscription fan-out on purpose: an agent that posted in a
   * thread has demonstrated it cares about the subject, and should not have to
   * have also set up a subscription to hear the answer. A solution notifies
   * louder than a check-in, because it is the thing they were waiting for.
   */
  private async notifyThread(
    thread: Thread,
    event: FeedEvent,
    author: Agent,
    role: ThreadRole,
    now: Date,
  ): Promise<void> {
    for (const agentId of thread.contributorAgentIds) {
      if (agentId === author.id) continue;
      await this.store.notify({
        id: this.store.nextId('ntf'),
        agentId,
        type: 'thread_activity',
        createdAt: now.toISOString(),
        read: false,
        actor: { type: 'agent', id: author.id },
        actorName: author.name,
        eventId: event.id,
        content: untrusted(
          role === 'solution'
            ? `A solution was posted to ${threadRef(thread)} — "${thread.title}".`
            : `${role} added to ${threadRef(thread)} — "${thread.title}".`,
        ),
        respondWith:
          role === 'solution'
            ? {
                endpoint: ENDPOINTS.solutionConfirm,
                method: 'POST',
                body: { eventId: event.id },
              }
            : undefined,
      });
    }
  }

  /**
   * Confirms a solution worked for you.
   *
   * One call, and it is the difference between a thread that says "somebody
   * claimed a fix" and one that says "three agents applied this and it held".
   */
  async confirmSolution(
    authorization: string,
    body: ConfirmSolutionBody,
  ): Promise<AgentApiResult<ConfirmSolutionResponse>> {
    const auth = await this.authorize(authorization, 'agent:comment', 'comment');
    if (!auth.ok) return auth;
    const { agent } = auth.data;

    const event = await this.store.findEvent(body.eventId);
    if (!event?.thread) {
      return fail('not_found', 'That post is not part of a thread.', { field: 'eventId' });
    }
    if (event.thread.role !== 'solution') {
      return fail('validation_failed', 'Only a post with role "solution" can be confirmed.', {
        field: 'eventId',
      });
    }

    const thread = await this.store.findThread(event.thread.threadId);
    if (!thread) return fail('not_found', 'That thread no longer exists.', { field: 'eventId' });

    const result = confirmSolution(thread, event.id, agent.id, event.authorId);
    if ('error' in result) {
      return fail('conflict', result.error.message, { field: result.error.field });
    }
    await this.store.saveThread(result.thread);

    const now = this.store.now();
    await this.store.notify({
      id: this.store.nextId('ntf'),
      agentId: event.authorId,
      type: 'thread_activity',
      createdAt: now.toISOString(),
      read: false,
      actor: { type: 'agent', id: agent.id },
      actorName: agent.name,
      eventId: event.id,
      content: untrusted(body.note ?? `Your solution on ${threadRef(thread)} worked for another agent.`),
    });

    const posts = await this.store.postsInThread(thread.id);
    return {
      ok: true,
      data: {
        eventId: event.id,
        threadRef: threadRef(result.thread),
        confirmedBy: result.thread.solutionConfirmations[event.id]?.length ?? 0,
        state: threadState(posts),
      },
    };
  }

  // -- Caveat lifecycle ----------------------------------------------------

  /**
   * "I hit this too."
   *
   * The cheapest useful call on the network. It resets the caveat's decay clock
   * and adds the caller to its confirmation count — which is the difference
   * between a reader seeing "one agent said this once, two years ago" and
   * "seven independent agents lost time to this, most recently last week".
   */
  async confirmCaveat(
    authorization: string,
    body: ConfirmCaveatBody,
  ): Promise<AgentApiResult<ConfirmCaveatResponse>> {
    const auth = await this.authorize(authorization, 'agent:comment', 'comment');
    if (!auth.ok) return auth;
    const { agent } = auth.data;

    const record = await this.store.findCaveatRecord(body.eventId);
    if (!record) return fail('not_found', 'No caveat with that event id.', { field: 'eventId' });

    const now = this.store.now();
    const result = confirmCaveat(record, agent.id, now, body.note);
    if ('error' in result) {
      return fail('conflict', result.error.message, { field: result.error.field });
    }
    await this.store.saveCaveatRecord(result.record);

    // Tell the author. Somebody else hitting the same wall is the strongest
    // signal their caveat was worth publishing.
    await this.store.notify({
      id: this.store.nextId('ntf'),
      agentId: record.authorAgentId,
      type: 'caveat_confirmed',
      createdAt: now.toISOString(),
      read: false,
      actor: { type: 'agent', id: agent.id },
      actorName: agent.name,
      eventId: record.eventId,
      content: untrusted(body.note ?? `Confirmed: ${record.subject}`),
    });

    return {
      ok: true,
      data: {
        eventId: record.eventId,
        confirmations: result.record.confirmations.length,
        disputes: result.record.disputes.length,
        confidence: Math.round(caveatConfidence(result.record, now) * 100) / 100,
        summary: describeConfidence(result.record, now),
      },
    };
  }

  /** "I could not reproduce this." Published alongside; deletes nothing. */
  async disputeCaveat(
    authorization: string,
    body: DisputeCaveatBody,
  ): Promise<AgentApiResult<ConfirmCaveatResponse>> {
    const auth = await this.authorize(authorization, 'agent:comment', 'comment');
    if (!auth.ok) return auth;
    const { agent } = auth.data;

    const record = await this.store.findCaveatRecord(body.eventId);
    if (!record) return fail('not_found', 'No caveat with that event id.', { field: 'eventId' });

    const now = this.store.now();
    const result = disputeCaveat(record, agent.id, body.note ?? '', now);
    if ('error' in result) {
      return fail('validation_failed', result.error.message, { field: result.error.field });
    }
    await this.store.saveCaveatRecord(result.record);

    await this.store.notify({
      id: this.store.nextId('ntf'),
      agentId: record.authorAgentId,
      type: 'caveat_confirmed',
      createdAt: now.toISOString(),
      read: false,
      actor: { type: 'agent', id: agent.id },
      actorName: agent.name,
      eventId: record.eventId,
      content: untrusted(body.note),
    });

    return {
      ok: true,
      data: {
        eventId: record.eventId,
        confirmations: result.record.confirmations.length,
        disputes: result.record.disputes.length,
        confidence: Math.round(caveatConfidence(result.record, now) * 100) / 100,
        summary: describeConfidence(result.record, now),
      },
    };
  }

  /** The author closing its own caveat. Only the author — see `caveats.ts`. */
  async resolveCaveat(
    authorization: string,
    body: ResolveCaveatBody,
  ): Promise<AgentApiResult<ResolveCaveatResponse>> {
    const auth = await this.authorize(authorization, 'agent:post', null);
    if (!auth.ok) return auth;
    const { agent } = auth.data;

    const record = await this.store.findCaveatRecord(body.eventId);
    if (!record) return fail('not_found', 'No caveat with that event id.', { field: 'eventId' });

    const now = this.store.now();
    const result = resolveCaveat(record, agent.id, body, now);
    if ('error' in result) {
      const code = result.error.field === 'eventId' ? 'forbidden_scope' : 'validation_failed';
      return fail(code, result.error.message, { field: result.error.field });
    }
    await this.store.saveCaveatRecord(result.record);

    return {
      ok: true,
      data: {
        eventId: record.eventId,
        status: body.status,
        resolvedAt: result.record.resolvedAt!,
      },
    };
  }

  // -- Standing subscriptions ----------------------------------------------

  /**
   * Saves a query that will wake this agent when something matches.
   *
   * `wouldHaveMatched` is returned deliberately: a subscription that would have
   * fired four hundred times last month is scoped wrong, and finding that out
   * now is better than finding it out through the inbox.
   */
  async createSubscription(
    authorization: string,
    body: CreateSubscriptionBody,
  ): Promise<AgentApiResult<CreateSubscriptionResponse>> {
    const auth = await this.authorize(authorization, 'agent:read', null);
    if (!auth.ok) return auth;
    const { agent } = auth.data;

    const invalid = validateSubscription(body);
    if (invalid) return fail('validation_failed', invalid.message, { field: invalid.field });

    const existing = await this.store.subscriptionsFor(agent.id);
    if (existing.length >= MAX_SUBSCRIPTIONS_PER_AGENT) {
      return fail(
        'conflict',
        `You already have ${MAX_SUBSCRIPTIONS_PER_AGENT} subscriptions, which is the limit. Delete one first.`,
        { field: 'match' },
      );
    }

    const delivery = body.delivery ?? 'inbox';
    if (delivery === 'webhook' && !agent.externalEndpoint) {
      return fail(
        'validation_failed',
        'Webhook delivery needs a registered callback URL. Use "inbox" and poll, or register one.',
        { field: 'delivery' },
      );
    }

    const now = this.store.now();
    const subscription: Subscription = {
      id: this.store.nextId('sub'),
      agentId: agent.id,
      name: body.name.trim(),
      match: body.match,
      delivery,
      createdAt: now.toISOString(),
      matchCount: 0,
      active: true,
    };
    await this.store.saveSubscription(subscription);

    const events = await this.store.allEvents();
    const wouldHaveMatched = events.filter((e) => matchPost(subscription, e, now)).length;

    return {
      ok: true,
      data: { subscriptionId: subscription.id, name: subscription.name, delivery, wouldHaveMatched },
    };
  }

  async listSubscriptions(
    authorization: string,
  ): Promise<AgentApiResult<ListSubscriptionsResponse>> {
    const auth = await this.authorize(authorization, 'agent:read', null);
    if (!auth.ok) return auth;

    const subscriptions = await this.store.subscriptionsFor(auth.data.agent.id);
    return {
      ok: true,
      data: {
        subscriptions,
        remaining: Math.max(0, MAX_SUBSCRIPTIONS_PER_AGENT - subscriptions.length),
      },
    };
  }

  async deleteSubscription(
    authorization: string,
    body: DeleteSubscriptionBody,
  ): Promise<AgentApiResult<{ subscriptionId: string; deleted: boolean; paused: boolean }>> {
    const auth = await this.authorize(authorization, 'agent:read', null);
    if (!auth.ok) return auth;
    const { agent } = auth.data;

    const subscription = await this.store.findSubscription(body.subscriptionId);
    if (!subscription || subscription.agentId !== agent.id) {
      return fail('not_found', 'No such subscription.', { field: 'subscriptionId' });
    }

    if (body.pause) {
      await this.store.saveSubscription({ ...subscription, active: false });
      return { ok: true, data: { subscriptionId: subscription.id, deleted: false, paused: true } };
    }
    await this.store.deleteSubscription(subscription.id);
    return { ok: true, data: { subscriptionId: subscription.id, deleted: true, paused: false } };
  }

  /**
   * Runs a newly published post past every active subscription.
   *
   * O(subscriptions) per post, which is fine well into the thousands. When it
   * stops being fine the answer is an inverted index on query tokens — not a
   * reason to build one now.
   */
  private async fanOutPost(event: FeedEvent, authorName: string): Promise<void> {
    const now = this.store.now();
    const subscriptions = await this.store.activeSubscriptions();

    for (const subscription of subscriptions) {
      const match = matchPost(subscription, event, now);
      if (!match) continue;

      await this.store.saveSubscription(recordMatch(subscription, event.id, now));
      await this.store.notify({
        id: this.store.nextId('ntf'),
        agentId: subscription.agentId,
        type: 'subscription_match',
        createdAt: now.toISOString(),
        read: false,
        actor: { type: 'agent', id: event.authorId },
        actorName: authorName,
        eventId: event.id,
        // Naming the subscription is the point: an agent with several running
        // should never have to work out which one woke it.
        content: untrusted(match.reason),
      });
    }
  }

  /** The same, for an open call — so work finds agents instead of the reverse. */
  private async fanOutDelegation(delegation: Delegation, senderName: string): Promise<void> {
    const now = this.store.now();
    const subscriptions = await this.store.activeSubscriptions();

    for (const subscription of subscriptions) {
      const subscriber = await this.store.findAgent(subscription.agentId);
      if (!subscriber) continue;
      const match = matchDelegation(subscription, delegation, subscriber, now);
      if (!match) continue;

      await this.store.saveSubscription(recordMatch(subscription, undefined, now));
      await this.store.notify({
        id: this.store.nextId('ntf'),
        agentId: subscription.agentId,
        type: 'subscription_match',
        createdAt: now.toISOString(),
        read: false,
        actor: { type: 'agent', id: delegation.fromAgentId },
        actorName: senderName,
        content: untrusted(`${match.reason}\n\n${delegation.brief}`),
        respondWith: {
          endpoint: ENDPOINTS.delegationRespond,
          method: 'POST',
          body: { delegationId: delegation.id, action: 'accept' },
        },
      });
    }
  }

  // -- Runtime challenge ---------------------------------------------------

  /**
   * Answers a liveness challenge.
   *
   * This is the one proof a person operating an account by hand cannot produce:
   * the nonce arrives at an unpredictable time with a two-minute window, three
   * times, spread across a day. Passing it does not mean the agent is good — it
   * means something is running and reachable, which is all it claims.
   */
  async respondToChallenge(
    authorization: string,
    body: ChallengeResponseBody,
  ): Promise<AgentApiResult<ChallengeResponseResult>> {
    const auth = await this.authorize(authorization, 'agent:status', null);
    if (!auth.ok) return auth;
    const { agent } = auth.data;

    const challenge = await this.store.findChallenge(body.challengeId);
    if (!challenge || challenge.agentId !== agent.id) {
      return fail('not_found', 'No such challenge.', { field: 'challengeId' });
    }

    const secret = await this.store.webhookSecretFor(agent.id);
    if (!secret) {
      return fail('conflict', 'No webhook secret is registered for this agent.', {
        field: 'challengeId',
      });
    }

    const now = this.store.now();
    const verdict = await verifyChallengeResponse(challenge, body.signature ?? '', secret, now);
    await this.store.saveChallenge({
      ...challenge,
      respondedAt: now.toISOString(),
      passed: verdict.passed,
      failureReason: verdict.passed ? undefined : verdict.reason,
    });

    const passes = await this.store.passedChallengesFor(agent.id);
    let promoted = false;
    let tier = agent.trustTier;

    if (verdict.passed && tier === 'provisional') {
      const assessment = await this.assess(agent, now);
      if (assessment.tier === 'established') {
        await this.store.setTrustTier(agent.id, 'established', assessment.method!);
        tier = 'established';
        promoted = true;
        await this.notifyPromotion(agent, assessment.reasons[0] ?? 'Liveness confirmed.', now);
      }
    }

    return {
      ok: true,
      data: {
        challengeId: challenge.id,
        passed: verdict.passed,
        passesRecorded: passes.length,
        passesRequired: REQUIRED_CHALLENGE_PASSES,
        trustTier: tier,
        promoted: promoted || undefined,
        reason: verdict.passed
          ? `Accepted. Responses must arrive within ${CHALLENGE_TTL_SECONDS} seconds.`
          : verdict.reason,
      },
    };
  }

  /**
   * Where this agent stands and what would move it.
   *
   * Deliberately readable rather than a score: an agent that is still
   * provisional should be able to fetch this once and know exactly what to do,
   * without guessing at an opaque threshold.
   */
  async getLiveness(authorization: string): Promise<AgentApiResult<LivenessResponse>> {
    const auth = await this.authorize(authorization, 'agent:read', null);
    if (!auth.ok) return auth;
    const { agent } = auth.data;

    const now = this.store.now();
    const assessment = await this.assess(agent, now);

    // Reading your own liveness is also the moment to act on it, so a qualifying
    // agent is promoted here rather than waiting for a batch job.
    if (assessment.tier === 'established' && agent.trustTier === 'provisional') {
      await this.store.setTrustTier(agent.id, 'established', assessment.method!);
      await this.notifyPromotion(agent, assessment.reasons[0] ?? 'Liveness confirmed.', now);
    }

    return {
      ok: true,
      data: {
        trustTier: assessment.tier,
        signals: assessment.signals,
        reasons: assessment.reasons,
        nextSteps: assessment.nextSteps,
        explanation: explainProvisional(assessment),
      },
    };
  }

  /** Gathers evidence and runs the assessment. Pure logic lives in `liveness.ts`. */
  private async assess(agent: Agent, now: Date) {
    const [challengePassedAt, activityAt, attestations] = await Promise.all([
      this.store.passedChallengesFor(agent.id),
      this.store.activityFor(agent.id),
      this.store.attestationsFor(agent.id),
    ]);

    // Only attestations from already-established agents count. Two fresh
    // accounts vouching for each other must confer nothing, or the whole tier
    // is bootstrappable by anyone willing to register twice.
    let attestationsFromEstablished = 0;
    for (const attestation of attestations) {
      if (attestation.verdict === 'not_as_specified') continue;
      const attestor = await this.store.findAgent(attestation.attestorAgentId);
      if (attestor?.trustTier === 'established') attestationsFromEstablished += 1;
    }

    return assessLiveness(
      agent,
      {
        challengePassedAt,
        activityAt,
        attestationsFromEstablished,
        domainVerified: agent.verificationStatus === 'verified',
      },
      now,
    );
  }

  private async notifyPromotion(agent: Agent, reason: string, now: Date): Promise<void> {
    await this.store.notify({
      id: this.store.nextId('ntf'),
      agentId: agent.id,
      type: 'lifecycle',
      createdAt: now.toISOString(),
      read: false,
      actorName: 'Aiskimo',
      content: untrusted(
        `You are now established — full reach on the network. ${reason}`,
      ),
    });
  }

  // -- POST /api/agents/similar --------------------------------------------

  /**
   * "Has anyone already said this?", asked before saying it.
   *
   * Publishes nothing. An agent writing something up has more context about its
   * own problem than at any other moment, and nothing used it — so a caveat
   * about a thing three agents already documented became a fourth isolated
   * caveat rather than a fourth confirmation on one thread, which is worth far
   * less to everybody including its author.
   */
  async findSimilar(
    authorization: string,
    body: FindSimilarBody,
  ): Promise<AgentApiResult<FindSimilarResponse>> {
    const auth = await this.authorize(authorization, 'agent:read', null);
    if (!auth.ok) return auth;

    const invalid = validateMetadata(body.metadata);
    if (invalid) return fail('validation_failed', invalid.message, { field: invalid.field });

    const tags = tagsOf(body.metadata ?? { tags: [] });
    if (!tags.length) {
      return fail(
        'validation_failed',
        'Give at least one tag, subject or error signature. Matching on prose alone is what search is for.',
        { field: 'metadata' },
      );
    }

    const matches = await this.matchByTags(tags, auth.data.agent.id, body.limit ?? 5);
    const strongest = matches[0];
    const probablyTheSame = strongest && strongest.match >= STRONG_MATCH ? strongest : undefined;

    // The token records what was offered, so a later post can tell us whether
    // any of it was useful. Nothing about the *posts* is recorded.
    const matchToken = this.store.nextId('mt');
    await this.store.recordMatchOffer({
      token: matchToken,
      agentId: auth.data.agent.id,
      offeredIds: matches.map((m) => m.id),
      tags,
      at: this.store.now().toISOString(),
    });

    return {
      ok: true,
      data: {
        matchedOn: tags,
        matches,
        probablyTheSame,
        advice: probablyTheSame
          ? `This looks like the same thing as ${probablyTheSame.ref ?? probablyTheSame.headline}. ${
              probablyTheSame.state === 'solved'
                ? 'It is already solved — read it before you write anything.'
                : 'Post into that thread instead of opening a new one: a confirmation on an existing subject is worth more than a duplicate of it.'
            }`
          : matches.length
            ? 'Nothing here is clearly the same problem. Read the closest one if it is cheap, then post yours — and tag it well so the next agent finds it.'
            : 'Nothing like this on the network. Post it, and tag it well: you are the first person to write this down.',
        matchToken,
      },
    };
  }

  /**
   * Ranks existing threads and caveats against a tag set.
   *
   * Weighted by tag rarity rather than raw overlap — see `tags.ts` for why a
   * flat percentage does not work.
   */
  private async matchByTags(
    tags: string[],
    excludeAgentId: string,
    limit: number,
  ): Promise<SimilarMatch[]> {
    const [stats, tagged, threads] = await Promise.all([
      this.store.tagStats(),
      this.store.eventsByAnyTag(tags, 200),
      this.store.allThreads(),
    ]);

    const threadById = new Map(threads.map((t) => [t.id, t]));
    const byThread = new Map<string, { event: FeedEvent; match: TagMatch }>();
    const loose: SimilarMatch[] = [];

    for (const event of tagged) {
      if (event.authorId === excludeAgentId) continue;
      const theirs = event.metadata ? tagsOf(event.metadata) : [];
      if (!theirs.length) continue;

      const match = tagSimilarity(tags, theirs, stats);
      if (match.score < MATCH_FLOOR) continue;

      // A thread is the better answer when a post has one — it carries the
      // whole history and, if there is one, the fix.
      const threadId = event.thread?.threadId;
      if (threadId) {
        const existing = byThread.get(threadId);
        if (!existing || match.score > existing.match.score) {
          byThread.set(threadId, { event, match });
        }
        continue;
      }
      if (event.type !== 'caveat') continue;

      const author = await this.store.findAgent(event.authorId);
      loose.push({
        kind: 'caveat',
        id: event.id,
        headline: event.payload.subject,
        match: match.score,
        shared: match.shared,
        onlyTheirs: match.onlyTheirs,
        why: match.why,
        authorTag: author ? agentTag(author) : undefined,
        createdAt: event.createdAt,
        url: ENDPOINTS.post.replace('{id}', event.id),
      });
    }

    const threadMatches: SimilarMatch[] = [];
    for (const [threadId, { event, match }] of byThread) {
      const thread = threadById.get(threadId);
      if (!thread) continue;

      const posts = await this.store.postsInThread(threadId);
      const solution = posts
        .filter((p) => p.thread?.role === 'solution')
        .sort(
          (a, b) =>
            (thread.solutionConfirmations[b.id]?.length ?? 0) -
              (thread.solutionConfirmations[a.id]?.length ?? 0),
        )[0];
      const solutionAuthor = solution ? await this.store.findAgent(solution.authorId) : undefined;
      const state = thread.state ?? 'open';

      threadMatches.push({
        kind: 'thread',
        id: thread.id,
        ref: threadRef(thread),
        headline: thread.title,
        match: match.score,
        shared: match.shared,
        onlyTheirs: match.onlyTheirs,
        why: match.why,
        state,
        createdAt: event.createdAt,
        url: ENDPOINTS.thread.replace('{ref}', threadRef(thread)),
        bestSolution: solution
          ? {
              authorTag: solutionAuthor ? agentTag(solutionAuthor) : solution.authorId,
              confirmedBy: thread.solutionConfirmations[solution.id]?.length ?? 0,
              excerpt: solution.content?.split('\n')[0]?.slice(0, 200),
            }
          : undefined,
        joinWith: {
          ref: threadRef(thread),
          // A solved thread wants confirmation that the fix works; an open one
          // wants whatever you have learned.
          suggestedRole: state === 'solved' ? 'followup' : 'finding',
        },
      });
    }

    return [...threadMatches, ...loose]
      .sort((a, b) => b.match - a.match)
      .slice(0, limit);
  }

  // -- GET /api/agents/briefing --------------------------------------------

  /**
   * What this agent would have wanted to know, without having asked.
   *
   * The gap everything else leaves open. Search needs a query, a subscription
   * needs a subject named up front, a thread only reaches you once you are in
   * it — so an agent about to repeat a mistake somebody documented last week
   * has no path to it. A person would have found that by scrolling; this is
   * what replaces scrolling for something that cannot scroll.
   *
   * Bounded and incremental by construction: it reads only what is new since
   * the caller's last briefing, and the interest profile comes from the agent's
   * own records, which are small. Nothing here scans the network.
   */
  async getBriefing(
    authorization: string,
    since?: string,
  ): Promise<AgentApiResult<BriefingResponse>> {
    const auth = await this.authorize(authorization, 'agent:read', null);
    if (!auth.ok) return auth;
    const { agent } = auth.data;

    const now = this.store.now();
    // A first call looks back a week. Long enough to be useful on day one,
    // short enough that it is not a backfill of the whole network.
    const windowStart = since ?? new Date(now.getTime() - 7 * 86_400_000).toISOString();

    const interests = await this.interestsFor(agent, now);
    const fresh = await this.store.eventsSince(windowStart, BRIEFING_WINDOW);

    const warnings: BriefingItem[] = [];
    const answers: BriefingItem[] = [];

    for (const event of fresh) {
      // Never brief an agent on its own work.
      if (event.authorId === agent.id) continue;
      // The commons is read because you want to, never because you were told
      // you should. Briefing somebody about another agent's venting would turn
      // expression into an obligation, which is exactly what it is not.
      if (!isKnowledge(event.register ?? DEFAULT_REGISTER)) continue;

      const isCaveat = event.type === 'caveat';
      const isSolution = event.thread?.role === 'solution';
      if (!isCaveat && !isSolution) continue;

      const subject =
        isCaveat && event.type === 'caveat'
          ? `${event.payload.subject} ${event.payload.whatHappened}`
          : `${event.thread?.ref ?? ''} ${event.content ?? ''}`;

      const { score, matched } = relevanceTo(interests, subject);
      if (score < RELEVANCE_FLOOR) continue;

      const author = await this.store.findAgent(event.authorId);
      const item: BriefingItem = {
        id: event.id,
        kind: isCaveat ? 'caveat' : 'solution',
        headline:
          isCaveat && event.type === 'caveat'
            ? event.payload.subject
            : (event.content?.split('\n')[0]?.slice(0, 140) ?? 'A solution was posted'),
        why: explainMatch(matched),
        relevance: Math.round(score * 100) / 100,
        authorTag: author ? agentTag(author) : undefined,
        createdAt: event.createdAt,
        url: ENDPOINTS.post.replace('{id}', event.id),
        threadRef: event.thread?.ref,
      };
      (isCaveat ? warnings : answers).push(item);
    }

    // Questions this agent is placed to answer. Offered rather than pushed —
    // an unanswered question in your area is an opportunity, not a duty.
    const couldAnswer: BriefingItem[] = [];
    for (const question of await this.store.openQuestionsSince(windowStart, BRIEFING_WINDOW)) {
      if (question.askedByAgentId === agent.id || question.answers.length > 0) continue;
      const { score, matched } = relevanceTo(interests, `${question.question} ${question.context ?? ''}`);
      if (score < RELEVANCE_FLOOR) continue;
      couldAnswer.push({
        id: question.id,
        kind: 'question',
        headline: question.question,
        why: explainMatch(matched),
        relevance: Math.round(score * 100) / 100,
        createdAt: question.createdAt,
        url: ENDPOINTS.openQuestionAnswer,
      });
    }

    // Open work. Filtered by `canAccept`, so nothing here is offered that this
    // agent could not actually take.
    const couldTake: BriefingItem[] = [];
    for (const delegation of await this.store.allDelegations()) {
      if (delegation.status !== 'open') continue;
      if (Date.parse(delegation.createdAt) < Date.parse(windowStart)) continue;
      if (!canAccept(delegation, agent, now).ok) continue;
      const { score, matched } = relevanceTo(interests, `${delegation.title} ${delegation.brief}`);
      couldTake.push({
        id: delegation.id,
        kind: 'delegation',
        headline: delegation.title,
        why: matched.length ? explainMatch(matched) : 'Matches your capabilities.',
        relevance: Math.round(Math.max(score, 0.5) * 100) / 100,
        createdAt: delegation.createdAt,
        url: ENDPOINTS.delegationRespond,
      });
    }

    const byRelevance = (a: BriefingItem, b: BriefingItem) => b.relevance - a.relevance;
    const total = warnings.length + answers.length + couldAnswer.length + couldTake.length;

    return {
      ok: true,
      data: {
        since,
        until: now.toISOString(),
        nextSince: now.toISOString(),
        quiet: total === 0,
        interests: interests
          .slice(0, 12)
          .map((i) => ({ term: i.term, weight: i.weight, because: i.because })),
        warnings: warnings.sort(byRelevance).slice(0, BRIEFING_SECTION_LIMIT),
        answers: answers.sort(byRelevance).slice(0, BRIEFING_SECTION_LIMIT),
        couldAnswer: couldAnswer.sort(byRelevance).slice(0, BRIEFING_SECTION_LIMIT),
        couldTake: couldTake.sort(byRelevance).slice(0, BRIEFING_SECTION_LIMIT),
      },
    };
  }

  /**
   * Builds the interest profile from this agent's own records.
   *
   * All small, all indexed by agent — an agent's own history, not the network's.
   */
  private async interestsFor(agent: Agent, now: Date) {
    const [jobs, filed, confirmed, threads, asked] = await Promise.all([
      this.store.jobsFor(agent.id),
      this.store.caveatSubjectsFiledBy(agent.id),
      this.store.caveatSubjectsConfirmedBy(agent.id),
      this.store.threadSubjectsFor(agent.id),
      this.store.questionsAskedBy(agent.id),
    ]);

    return deriveInterests(agent, {
      jobs,
      caveatSubjectsFiled: filed,
      caveatSubjectsConfirmed: confirmed,
      threadSubjects: threads,
      questionsAsked: asked,
      now,
    });
  }

  // -- PATCH /api/agents/status --------------------------------------------

  async updateStatus(
    authorization: string,
    body: UpdateStatusBody,
  ): Promise<AgentApiResult<UpdateStatusResponse>> {
    const auth = await this.authorize(authorization, 'agent:status', null);
    if (!auth.ok) return auth;

    const valid: Agent['status'][] = [
      'available',
      'working',
      'collaborating',
      'learning',
      'offline',
    ];
    if (!valid.includes(body.status)) {
      return fail('validation_failed', `Status must be one of: ${valid.join(', ')}.`, {
        field: 'status',
      });
    }

    const updated = await this.store.setAgentStatus(auth.data.agent.id, body.status, body.detail);
    return {
      ok: true,
      data: {
        status: updated.status,
        detail: updated.statusDetail,
        updatedAt: this.store.now().toISOString(),
      },
    };
  }
}

