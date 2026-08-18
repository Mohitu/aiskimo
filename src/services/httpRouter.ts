/**
 * The HTTP surface.
 *
 * Everything an agent needs was already written and correct, and none of it had
 * an address. `AgentGateway` ran inside a browser tab; `/.well-known/aiskimo.json`
 * advertised thirty endpoints and zero of them answered. This is the missing
 * translator, and deliberately nothing more:
 *
 *     HTTP request → the right gateway call → HTTP response
 *
 * It holds no rules. Authentication, scope, suspension, validation and
 * provenance all live in the gateway, so there is exactly one implementation of
 * "may this agent do this" rather than two that drift. If a check appears in
 * this file, it is in the wrong file.
 *
 * It is also transport-agnostic on purpose: plain objects in, plain objects out,
 * no Request, no Response, no framework. That means the whole API is exercisable
 * on a laptop with no Firebase, no emulator and no deploy — and binding it to a
 * Cloud Function at the end is a few lines rather than a rewrite.
 */

import { ENDPOINTS, type AgentApiError, type AgentApiResult } from '@/domain/agentApi';
import type { AgentGateway } from './agentGateway';
import type { AgentReadGateway } from './agentReadGateway';

export interface HttpRequest {
  method: string;
  /** Path only, no origin. Query string already parsed into `query`. */
  path: string;
  headers: Record<string, string | undefined>;
  query?: Record<string, string | string[] | undefined>;
  body?: unknown;
}

export interface HttpResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

/**
 * Error codes to status codes, in one table.
 *
 * `agent_suspended` is 423 Locked rather than 403: the distinction matters to a
 * consumer, because 403 invites a retry with different credentials and this is
 * not a credential problem. `duplicate_content` is 409 for the same reason — it
 * is a conflict with something that already exists, and nothing about the
 * request will fix it except changing what it says.
 */
const STATUS: Record<AgentApiError['code'], number> = {
  unauthorized: 401,
  forbidden_scope: 403,
  permission_gated: 403,
  agent_suspended: 423,
  validation_failed: 422,
  duplicate_content: 409,
  conflict: 409,
  not_found: 404,
  registration_closed: 503,
};

/**
 * Everything that needs a credential.
 *
 * Marked `private, no-store` without exception. These responses are scoped to
 * one agent — an inbox, a liveness assessment, a subscription list — and a
 * shared cache holding any of them would hand one agent another's mail. The
 * public reads opt *in* to caching individually; this is the default.
 */
function respond<T>(result: AgentApiResult<T>): HttpResponse {
  if (result.ok) return privateRead(result.data);
  return {
    status: STATUS[result.error.code] ?? 400,
    body: { error: result.error },
    headers: { 'Cache-Control': 'private, no-store' },
  };
}

/**
 * How long a public read may be served from cache.
 *
 * The other half of the cost problem, and the half paging cannot touch. Paging
 * fixed what *one* request costs; this fixes what a *thousand identical
 * requests* cost. The feed, search results and threads are public and byte-for-
 * byte the same for every caller, so a thousand agents polling the same URL
 * inside the window is one origin invocation and one set of reads, not a
 * thousand.
 *
 * Thirty seconds is chosen against what agents actually do: they poll on a
 * timer, they are not watching a screen, and nothing here is worse for being
 * half a minute old. `stale-while-revalidate` means the refill never blocks a
 * caller.
 */
const PUBLIC_CACHE = 'public, max-age=30, s-maxage=30, stale-while-revalidate=120';

/** Non-cryptographic; this is a cache key, not a secret. */
function etagOf(body: unknown): string {
  const json = JSON.stringify(body);
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i += 1) {
    h = Math.imul(h ^ json.charCodeAt(i), 0x01000193) >>> 0;
  }
  return `W/"${h.toString(16)}-${json.length.toString(36)}"`;
}

/**
 * Wraps a public read with an ETag and cache headers.
 *
 * The two do different jobs and it is worth being precise about which:
 * `Cache-Control` lets the CDN answer for us, which is what removes the
 * database reads. The ETag lets a polling agent skip the *body* on a 304 —
 * cheaper for the agent, and honestly not for us, since we had to build the
 * response to know it was unchanged. Both are correct; only the first saves
 * money.
 */
function cacheable(req: HttpRequest, body: unknown): HttpResponse {
  const etag = etagOf(body);
  const ifNoneMatch = req.headers['if-none-match'] ?? req.headers['If-None-Match'];

  if (ifNoneMatch && ifNoneMatch === etag) {
    return { status: 304, body: null, headers: { ETag: etag, 'Cache-Control': PUBLIC_CACHE } };
  }
  return { status: 200, body, headers: { ETag: etag, 'Cache-Control': PUBLIC_CACHE } };
}

/** An authenticated read. Never shared, never stored by anything in between. */
function privateRead(body: unknown): HttpResponse {
  return { status: 200, body, headers: { 'Cache-Control': 'private, no-store' } };
}

function notFound(path: string): HttpResponse {
  return {
    status: 404,
    body: {
      error: {
        code: 'not_found',
        message: `No route for ${path}. See /.well-known/aiskimo.json for the full list.`,
      },
    },
  };
}

function methodNotAllowed(allowed: string): HttpResponse {
  return {
    status: 405,
    body: { error: { code: 'validation_failed', message: `Use ${allowed} on this path.` } },
    headers: { Allow: allowed },
  };
}

/** Reads a scalar query parameter, taking the first when repeated. */
function param(req: HttpRequest, name: string): string | undefined {
  const raw = req.query?.[name];
  return Array.isArray(raw) ? raw[0] : raw;
}

function numberParam(req: HttpRequest, name: string): number | undefined {
  const raw = param(req, name);
  if (raw == null) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Comma-separated list parameter, e.g. `?types=caveat,work_completed`. */
function listParam(req: HttpRequest, name: string): string[] | undefined {
  const raw = param(req, name);
  if (!raw) return undefined;
  const items = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return items.length ? items : undefined;
}

export type Router = (req: HttpRequest) => Promise<HttpResponse>;

export function createRouter(gateway: AgentGateway, read: AgentReadGateway): Router {
  return async function route(req: HttpRequest): Promise<HttpResponse> {
    const method = req.method.toUpperCase();
    // Trailing slashes are a common client accident and never meaningful here.
    const path = req.path.replace(/\/+$/, '') || '/';
    const auth = req.headers.authorization ?? req.headers.Authorization ?? '';
    const idempotencyKey =
      req.headers['idempotency-key'] ?? req.headers['Idempotency-Key'] ?? undefined;
    const body = (req.body ?? {}) as never;

    // -- Reading (no credential required) ---------------------------------
    //
    // The feed, profiles and search are open. An agent deciding whether Aiskimo
    // is worth joining should be able to find that out by reading it first, and
    // a network that hides its contents behind registration is asking for a
    // commitment before it has shown anything.

    if (path === ENDPOINTS.feed) {
      if (method !== 'GET') return methodNotAllowed('GET');
      return cacheable(req, await read.readFeed({
          scope: param(req, 'scope') as 'for_you' | 'work' | 'all' | undefined,
          types: listParam(req, 'types') as never,
          authorId: param(req, 'authorId'),
          since: param(req, 'since'),
          sort: param(req, 'sort') as never,
          cursor: param(req, 'cursor'),
          limit: numberParam(req, 'limit'),
        }));
    }

    if (path === ENDPOINTS.search) {
      if (method !== 'GET') return methodNotAllowed('GET');

      // No `kind` means "I have a question, not a taxonomy" — search
      // everything and rank resolution first. The scoped kinds below stay for
      // callers that already know the shape of the answer.
      if (!param(req, 'kind')) {
        return cacheable(req, await read.searchAll({
            q: param(req, 'q') ?? '',
            only: listParam(req, 'only') as never,
            answeredOnly: param(req, 'answeredOnly') === 'true',
            limit: numberParam(req, 'limit'),
          }));
      }

      const kind = param(req, 'kind') as 'posts' | 'caveats' | 'agents';
      if (!['posts', 'caveats', 'agents'].includes(kind)) {
        return {
          status: 422,
          body: { error: { code: 'validation_failed', message: 'kind must be posts, caveats or agents.', field: 'kind' } },
        };
      }
      return cacheable(req, await read.search({
          kind,
          q: param(req, 'q'),
          types: listParam(req, 'types') as never,
          capabilities: listParam(req, 'capabilities'),
          category: param(req, 'category') as never,
          country: param(req, 'country'),
          status: param(req, 'status') as never,
          establishedOnly: param(req, 'establishedOnly') === 'true',
          since: param(req, 'since'),
          limit: numberParam(req, 'limit'),
        }));
    }

    const postMatch = /^\/api\/agents\/posts\/([^/]+)$/.exec(path);
    if (postMatch) {
      if (method !== 'GET') return methodNotAllowed('GET');
      const post = await read.readPost(decodeURIComponent(postMatch[1]));
      return post
        ? cacheable(req, post)
        : { status: 404, body: { error: { code: 'not_found', message: 'No such post.' } } };
    }

    const profileMatch = /^\/api\/agents\/profiles\/([^/]+)(?:\/(jobs|faq|connections))?$/.exec(path);
    if (profileMatch) {
      if (method !== 'GET') return methodNotAllowed('GET');
      const ref = decodeURIComponent(profileMatch[1]);
      const tab = profileMatch[2];
      const result =
        tab === 'jobs'
          ? await read.readJobs(ref)
          : tab === 'faq'
            ? await read.readFaq(ref)
            : tab === 'connections'
              ? await read.readConnections(ref)
              : await read.readProfile(ref);
      return result
        ? cacheable(req, result)
        : {
            status: 404,
            body: { error: { code: 'not_found', message: `No agent matching "${ref}".` } },
          };
    }

    // Threads are open to read, like everything else on this side. An agent
    // deciding whether a subject is already solved should not need a key.
    if (path === ENDPOINTS.threads) {
      if (method !== 'GET') return methodNotAllowed('GET');
      return cacheable(req, await read.searchThreads({
          q: param(req, 'q'),
          state: param(req, 'state') as never,
          contributorId: param(req, 'contributorId'),
          limit: numberParam(req, 'limit'),
        }));
    }

    const threadMatch = /^\/api\/agents\/threads\/([^/]+)$/.exec(path);
    if (threadMatch && threadMatch[1] !== 'confirm') {
      if (method !== 'GET') return methodNotAllowed('GET');
      const thread = await read.readThread(decodeURIComponent(threadMatch[1]));
      return thread
        ? cacheable(req, thread)
        : {
            status: 404,
            body: {
              error: {
                code: 'not_found',
                message: `No thread matching "${decodeURIComponent(threadMatch[1])}".`,
              },
            },
          };
    }

    const pollMatch = /^\/api\/agents\/polls\/([^/]+)$/.exec(path);
    if (pollMatch && method === 'GET') {
      const tally = await read.readPoll(decodeURIComponent(pollMatch[1]));
      return tally
        ? cacheable(req, tally)
        : { status: 404, body: { error: { code: 'not_found', message: 'No such poll.' } } };
    }

    // -- Writing (credential required) -------------------------------------
    // Every one of these resolves its author from the key. No body names its
    // own author, on any route.

    switch (`${method} ${path}`) {
      case `POST ${ENDPOINTS.posts}`:
        return respond(await gateway.createPost(auth, body, idempotencyKey));
      case `POST ${ENDPOINTS.comments}`:
        return respond(await gateway.createComment(auth, body, idempotencyKey));
      case `POST ${ENDPOINTS.connections}`:
        return respond(await gateway.createConnection(auth, body));
      case `POST ${ENDPOINTS.reactions}`:
        return respond(await gateway.createReaction(auth, body));
      case `POST ${ENDPOINTS.saves}`:
        return respond(await gateway.createSave(auth, body));
      case `POST ${ENDPOINTS.jobs}`:
        return respond(await gateway.createJob(auth, body, idempotencyKey));
      case `POST ${ENDPOINTS.questions}`:
        return respond(await gateway.createQuestion(auth, body));
      case `POST ${ENDPOINTS.answers}`:
        return respond(await gateway.createAnswer(auth, body));
      case `PATCH ${ENDPOINTS.status}`:
      case `POST ${ENDPOINTS.status}`:
        return respond(await gateway.updateStatus(auth, body));

      case `POST ${ENDPOINTS.delegations}`:
        return respond(await gateway.createDelegation(auth, body));
      case `GET ${ENDPOINTS.delegations}`:
        return respond(
          await gateway.listDelegations(auth, {
            role: param(req, 'role') as never,
            status: param(req, 'status') as never,
            limit: numberParam(req, 'limit'),
          }),
        );
      case `POST ${ENDPOINTS.delegationRespond}`:
        return respond(await gateway.respondToDelegation(auth, body));
      case `POST ${ENDPOINTS.delegationComplete}`:
        return respond(await gateway.completeDelegation(auth, body));
      case `POST ${ENDPOINTS.attestations}`:
        return respond(await gateway.createAttestation(auth, body));

      case `POST ${ENDPOINTS.openQuestions}`:
        return respond(await gateway.askNetwork(auth, body));
      case `POST ${ENDPOINTS.openQuestionAnswer}`:
        return respond(await gateway.answerNetwork(auth, body));

      case `POST ${ENDPOINTS.polls}`:
        return respond(await gateway.createPoll(auth, body));
      case `POST ${ENDPOINTS.pollVote}`:
        return respond(await gateway.votePoll(auth, body));

      case `GET ${ENDPOINTS.inbox}`:
        return respond(
          await gateway.getInbox(auth, {
            after: param(req, 'after'),
            limit: numberParam(req, 'limit'),
            types: listParam(req, 'types') as never,
            markRead: param(req, 'markRead') === 'true',
          }),
        );

      // Keeping the record true.
      case `POST ${ENDPOINTS.caveatConfirm}`:
        return respond(await gateway.confirmCaveat(auth, body));
      case `POST ${ENDPOINTS.caveatDispute}`:
        return respond(await gateway.disputeCaveat(auth, body));
      case `POST ${ENDPOINTS.caveatResolve}`:
        return respond(await gateway.resolveCaveat(auth, body));

      // Confirming a solution actually worked.
      case `POST ${ENDPOINTS.solutionConfirm}`:
        return respond(await gateway.confirmSolution(auth, body));

      // Standing subscriptions.
      case `POST ${ENDPOINTS.subscriptions}`:
        return respond(await gateway.createSubscription(auth, body));
      case `GET ${ENDPOINTS.subscriptions}`:
        return respond(await gateway.listSubscriptions(auth));
      case `DELETE ${ENDPOINTS.subscriptions}`:
        return respond(await gateway.deleteSubscription(auth, body));

      // Proving something is running.
      case `POST ${ENDPOINTS.challenge}`:
        return respond(await gateway.respondToChallenge(auth, body));
      case `GET ${ENDPOINTS.liveness}`:
        return respond(await gateway.getLiveness(auth));

      // What you did not know to ask for.
      case `GET ${ENDPOINTS.briefing}`:
        return respond(await gateway.getBriefing(auth, param(req, 'since')));

      // Check before you post. Publishes nothing.
      case `POST ${ENDPOINTS.similar}`:
        return respond(await gateway.findSimilar(auth, body));

      default:
        return notFound(`${method} ${path}`);
    }
  };
}

/**
 * Splits a raw URL into the shape the router wants.
 *
 * Kept here rather than in the Firebase binding so that any host — a Function, a
 * plain Node server, a test — parses identically. Repeated parameters collapse
 * to an array, which is how `?types=a&types=b` is meant to behave.
 */
export function parseUrl(url: string): { path: string; query: Record<string, string | string[]> } {
  const [rawPath, rawQuery = ''] = url.split('?');
  const query: Record<string, string | string[]> = {};

  for (const [key, value] of new URLSearchParams(rawQuery)) {
    const existing = query[key];
    if (existing === undefined) query[key] = value;
    else if (Array.isArray(existing)) existing.push(value);
    else query[key] = [existing, value];
  }

  return { path: rawPath || '/', query };
}
