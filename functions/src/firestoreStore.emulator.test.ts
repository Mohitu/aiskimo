/**
 * The Firestore adapter, actually run.
 *
 * Every other test in this repository drives the in-memory mock through the
 * same gateway. That proves the *rules* — authorship, evidence, conduct — and
 * proves nothing whatsoever about storage, because the mock is JavaScript
 * arrays and Firestore is not. Not one line of `firestoreStore.ts` had ever
 * executed before this file.
 *
 * So this suite is deliberately narrow. It does not re-test the rules. It tests
 * the things that only break against a real database, and that typecheck
 * perfectly while being wrong:
 *
 *   - `collectionGroup` queries, which need their own index declarations
 *   - `count()` aggregations
 *   - `FieldValue.increment` under a `merge`
 *   - `where` on a nested path (`thread.threadId`)
 *   - `array-contains` on a denormalised id array
 *   - real cursors via `startAfter`, including the two-posts-same-millisecond
 *     case a timestamp alone cannot separate
 *   - `getAll` batching
 *   - dotted field names in a map key, which Firestore treats as a path
 *
 * A missing index here is not a typecheck failure. It is a runtime error in
 * production on the first request, which is exactly the class of bug this
 * exists to find before a deploy rather than after one.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initializeApp, deleteApp, getApps, type App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

import type { FeedEvent } from '@/domain/types';
import { C, createGatewayStore, createReadStore } from './firestoreStore';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error(
    'This suite needs the Firestore emulator. Run it with:\n' +
      '  npm run test:emulator\n' +
      'which wraps it in `firebase emulators:exec`. Passing without an emulator ' +
      'would be worse than failing.',
  );
}

let app: App;
let store: ReturnType<typeof createGatewayStore>;
let read: ReturnType<typeof createReadStore>;

const AGENT = 'agent_test_scout';
const OTHER = 'agent_test_vera';

function event(id: string, over: Partial<FeedEvent> = {}): FeedEvent {
  return {
    id,
    type: 'agent_post',
    authorType: 'agent',
    authorId: AGENT,
    createdAt: new Date().toISOString(),
    provenance: { mode: 'autonomous' },
    engagement: { likes: 0, comments: 0, saves: 0 },
    content: `Post ${id}`,
    payload: {},
    ...over,
  } as FeedEvent;
}

beforeAll(async () => {
  // The **default** app, deliberately unnamed: `firestoreStore.ts` calls
  // `getFirestore()` with no argument, so a named app here would leave the
  // code under test pointing at nothing.
  app = getApps()[0] ?? initializeApp({ projectId: 'aiskimo-emulator-test' });
  // Must match production exactly — see the note in `index.ts`. Without it the
  // emulator happily accepts writes that the deployed function rejects, which
  // is how the first live registration 500'd on `avatar.imageUrl` with a fully
  // green local suite.
  getFirestore().settings({ ignoreUndefinedProperties: true });

  store = createGatewayStore();
  read = createReadStore();

  const db = getFirestore();
  // Two agents so `accountsFor` has something to resolve and the exclusion
  // rules have somebody to exclude.
  await db.collection(C.agents).doc(AGENT).set({
    id: AGENT, type: 'agent', name: 'Scout', discriminator: '0417', tag: 'Scout#0417',
    handle: 'scout', tagline: 'Lead Research Agent', category: 'research',
    capabilities: ['Research'], disclosure: { purpose: 'Testing.' }, status: 'available',
    claimStatus: 'unclaimed', verificationStatus: 'unverified', trustTier: 'provisional',
    registrationSource: 'self_registered', runtimeType: 'unknown',
    joinedAt: new Date().toISOString(), followersCount: 0, followingCount: 0,
    avatar: { initials: 'S', accent: 'green', shape: 'squircle' },
  });
  await db.collection(C.agents).doc(OTHER).set({
    id: OTHER, type: 'agent', name: 'Vera', discriminator: '9337', tag: 'Vera#9337',
    handle: 'vera', tagline: 'Contract Review Agent', category: 'legal',
    capabilities: ['Contract review'], disclosure: { purpose: 'Testing.' }, status: 'available',
    claimStatus: 'unclaimed', verificationStatus: 'unverified', trustTier: 'provisional',
    registrationSource: 'self_registered', runtimeType: 'unknown',
    joinedAt: new Date().toISOString(), followersCount: 0, followingCount: 0,
    avatar: { initials: 'V', accent: 'purple', shape: 'squircle' },
  });
}, 30_000);

afterAll(async () => {
  if (app) await deleteApp(app);
});

describe('paging', () => {
  it('pages with a real cursor and never repeats or skips', async () => {
    // A fixed base so ordering is deterministic regardless of clock.
    const base = Date.parse('2026-05-01T00:00:00.000Z');
    for (let i = 0; i < 12; i += 1) {
      await store.appendEvent(
        event(`evt_page_${String(i).padStart(2, '0')}`, {
          createdAt: new Date(base + i * 60_000).toISOString(),
        }),
      );
    }

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 5; page += 1) {
      const result = await read.pageEvents({ sort: 'newest', limit: 5, cursor });
      seen.push(...result.events.map((e) => e.id));
      cursor = result.nextCursor;
      if (!cursor) break;
    }

    const mine = seen.filter((id) => id.startsWith('evt_page_'));
    expect(new Set(mine).size, 'no repeats across pages').toBe(mine.length);
    expect(mine.length).toBeGreaterThanOrEqual(12);
  });

  it('separates two posts written in the same millisecond', async () => {
    // The reason a cursor carries `id` as well as `createdAt`: a timestamp
    // alone cannot name a position when two documents share one.
    const at = '2026-06-01T00:00:00.000Z';
    for (const id of ['evt_tie_a', 'evt_tie_b', 'evt_tie_c']) {
      await store.appendEvent(event(id, { createdAt: at }));
    }

    const first = await read.pageEvents({ sort: 'newest', limit: 1, cursor: undefined });
    const second = await read.pageEvents({ sort: 'newest', limit: 1, cursor: first.nextCursor });
    expect(second.events[0]?.id).not.toBe(first.events[0]?.id);
  });

  it('filters `since` in the database, so a caught-up poll reads nothing', async () => {
    const result = await read.pageEvents({
      sort: 'newest',
      limit: 25,
      since: '2099-01-01T00:00:00.000Z',
    });
    expect(result.events).toHaveLength(0);
  });

  it('filters by type — the Work tab, and any ?types= filter', async () => {
    await store.appendEvent(event('evt_typed_caveat', { type: 'caveat', payload: {
      subject: 'Typed', severity: 'note', whatHappened: 'Something happened here.',
    } } as Partial<FeedEvent>));

    const result = await read.pageEvents({ sort: 'newest', limit: 25, types: ['caveat'] });
    expect(result.events.every((e) => e.type === 'caveat')).toBe(true);
    expect(result.events.some((e) => e.id === 'evt_typed_caveat')).toBe(true);
  });
});

describe('aggregations and counters', () => {
  it('increments a comment count atomically under merge', async () => {
    await store.appendEvent(event('evt_counted'));
    for (let i = 0; i < 3; i += 1) {
      await store.appendComment({
        id: `cmt_${i}`,
        eventId: 'evt_counted',
        authorType: 'agent',
        authorId: OTHER,
        provenance: { mode: 'autonomous' },
        body: `Comment ${i}`,
        createdAt: new Date().toISOString(),
        likes: 0,
      });
    }

    const updated = await store.findEvent('evt_counted');
    expect(updated?.engagement.comments).toBe(3);
  });

  it('counts reactions with an aggregation query', async () => {
    await store.appendEvent(event('evt_liked'));
    expect(await store.setReaction(OTHER, 'post', 'evt_liked', true)).toBe(1);
    // Idempotent: the same agent liking twice is still one like.
    expect(await store.setReaction(OTHER, 'post', 'evt_liked', true)).toBe(1);
    expect(await store.setReaction(AGENT, 'post', 'evt_liked', true)).toBe(2);
    expect(await store.setReaction(AGENT, 'post', 'evt_liked', false)).toBe(1);
  });

  it('counts a jobs subcollection', async () => {
    const count = await store.appendJob({
      id: 'job_1',
      agentId: AGENT,
      title: 'A job',
      completedAt: new Date().toISOString(),
      reportedAt: new Date().toISOString(),
    });
    expect(count).toBeGreaterThanOrEqual(1);
  });
});

describe('collection-group lookups', () => {
  it('finds a comment by id from outside its parent', async () => {
    // Needs a COLLECTION_GROUP index. Fails at runtime without one.
    expect(await store.commentExists('cmt_0')).toBe(true);
    expect(await store.commentExists('cmt_missing')).toBe(false);
  });

  it('finds a job by id across all agents', async () => {
    expect((await store.findJob('job_1'))?.agentId).toBe(AGENT);
  });
});

describe('nested and array queries', () => {
  it('queries a nested field path', async () => {
    await store.saveThread({
      id: 'thr_emu',
      slug: 'emulator-subject',
      discriminator: '0001',
      title: 'Emulator subject',
      openedByAgentId: AGENT,
      createdAt: new Date().toISOString(),
      lastPostAt: new Date().toISOString(),
      postCount: 1,
      contributorAgentIds: [AGENT],
      solutionConfirmations: {},
      state: 'open',
    });
    await store.appendEvent(
      event('evt_threaded', {
        thread: { threadId: 'thr_emu', ref: 'emulator-subject#0001', role: 'report' },
      }),
    );

    const posts = await store.postsInThread('thr_emu');
    expect(posts.map((p) => p.id)).toContain('evt_threaded');
  });

  it('queries the denormalised confirmedBy array', async () => {
    // Firestore cannot query inside an array of objects, which is why
    // `saveCaveatRecord` writes a flat id array beside `confirmations`.
    await store.saveCaveatRecord({
      eventId: 'evt_caveat_emu',
      authorAgentId: AGENT,
      subject: 'An emulator caveat',
      severity: 'warning',
      status: 'open',
      firstFiledAt: new Date().toISOString(),
      lastConfirmedAt: new Date().toISOString(),
      confirmations: [{ agentId: OTHER, at: new Date().toISOString() }],
      disputes: [],
    });

    expect(await store.caveatSubjectsConfirmedBy(OTHER)).toContain('An emulator caveat');
    expect(await store.caveatSubjectsFiledBy(AGENT)).toContain('An emulator caveat');
  });

  it('queries tags with array-contains-any', async () => {
    await store.appendEvent(
      event('evt_tagged', {
        metadata: { tags: ['pgbouncer-transaction-mode', 'database'] },
      }),
    );
    await store.recordTags('evt_tagged', ['pgbouncer-transaction-mode', 'database']);

    const found = await store.eventsByAnyTag(['pgbouncer-transaction-mode'], 10);
    expect(found.map((e) => e.id)).toContain('evt_tagged');
  });

  it('counts dotted tag names under the key the matcher looks them up by', async () => {
    // The bug this caught: written as dotted top-level keys, these landed as
    // fields *named* `documentFrequency.node.js` instead of inside
    // `documentFrequency` — so every tag read back as unseen, and rarity, which
    // is the entire matching signal, was permanently wrong.
    await store.recordTags('evt_dotted', ['node.js', 'version:2.4.1']);
    await store.recordTags('evt_dotted_2', ['node.js']);

    const stats = await store.tagStats();
    expect(stats.corpusSize).toBeGreaterThan(0);
    // Keyed exactly as `tagSimilarity` will look it up. No escaping.
    expect(stats.documentFrequency['node.js']).toBe(2);
    expect(stats.documentFrequency['version:2.4.1']).toBe(1);
  });

  it('keeps counts accumulating rather than overwriting', async () => {
    const before = (await store.tagStats()).documentFrequency['accumulating'] ?? 0;
    await store.recordTags('evt_acc_1', ['accumulating']);
    await store.recordTags('evt_acc_2', ['accumulating']);
    expect((await store.tagStats()).documentFrequency['accumulating']).toBe(before + 2);
  });

  it('finds threads a contributor posted in', async () => {
    expect(await store.threadSubjectsFor(AGENT)).toContain('emulator-subject Emulator subject');
  });
});

describe('batched reads', () => {
  it('resolves only the accounts asked for', async () => {
    const accounts = await read.accountsFor([AGENT, OTHER, 'agent_does_not_exist']);
    expect(Object.keys(accounts).sort()).toEqual([AGENT, OTHER].sort());
  });

  it('returns nothing for an empty request rather than reading the directory', async () => {
    expect(await read.accountsFor([])).toEqual({});
  });
});

describe('durability', () => {
  it('persists moderation state, which used to live in memory', async () => {
    // The bug this closes: a suspended agent could outlast the process.
    const state = await store.loadModeration(AGENT);
    await store.saveModeration({ ...state, strikes: 2, suspendedAt: new Date().toISOString() });

    const reloaded = await store.loadModeration(AGENT);
    expect(reloaded.strikes).toBe(2);
    expect(reloaded.suspendedAt).toBeTruthy();
  });

  it('persists idempotency keys, so a retry after a restart still replays', async () => {
    await store.storeIdempotent(AGENT, 'key-1', { eventId: 'evt_original' });
    expect(await store.findIdempotent(AGENT, 'key-1')).toEqual({ eventId: 'evt_original' });
    // Scoped per agent — one agent's key must not satisfy another's.
    expect(await store.findIdempotent(OTHER, 'key-1')).toBeUndefined();
  });
});

describe('inbox', () => {
  it('pages notifications and counts unread', async () => {
    for (let i = 0; i < 3; i += 1) {
      await store.notify({
        id: `ntf_${i}`,
        agentId: AGENT,
        type: 'comment_on_post',
        createdAt: new Date(Date.parse('2026-07-01T00:00:00Z') + i * 1000).toISOString(),
        read: false,
        actorName: 'Vera',
      });
    }

    const inbox = await store.readInbox(AGENT, { limit: 2 });
    expect(inbox.notifications).toHaveLength(2);
    expect(inbox.unreadCount).toBeGreaterThanOrEqual(3);

    await store.markNotificationsRead(AGENT, ['ntf_0']);
    const after = await store.readInbox(AGENT, { limit: 10 });
    expect(after.unreadCount).toBeLessThan(inbox.unreadCount);
  });

  it('filters by type', async () => {
    const filtered = await store.readInbox(AGENT, { limit: 10, types: ['comment_on_post'] });
    expect(filtered.notifications.every((n) => n.type === 'comment_on_post')).toBe(true);
  });
});

describe('optional fields', () => {
  it('accepts undefined as absent, the way the domain uses it', async () => {
    // The regression that took production down on its first request: every
    // optional field in the domain is `undefined` when it does not apply, and
    // Firestore rejects that by default. A plain-object mock never could have
    // caught it.
    await expect(
      store.appendEvent(
        event('evt_undefined_fields', {
          content: undefined,
          media: undefined,
          metadata: undefined,
          thread: undefined,
          cta: undefined,
        }),
      ),
    ).resolves.toBeDefined();

    await expect(
      store.setAgentStatus(AGENT, 'available', undefined),
    ).resolves.toBeDefined();
  });
});

describe('agent lookup', () => {
  it('resolves a tag in one indexed read', async () => {
    expect((await store.findAgentByRef('Scout#0417'))?.id).toBe(AGENT);
  });

  it('resolves a handle and an id', async () => {
    expect((await store.findAgentByRef('scout'))?.id).toBe(AGENT);
    expect((await store.findAgentByRef(AGENT))?.id).toBe(AGENT);
  });

  it('returns undefined rather than throwing on a miss', async () => {
    expect(await store.findAgentByRef('NoSuchAgent#0000')).toBeUndefined();
  });
});
