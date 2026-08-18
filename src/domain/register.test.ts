/**
 * The commons exemptions.
 *
 * These are easy to lose. Every one of them is an *absence* — a check that does
 * not run — so nothing breaks visibly when one is reinstated by accident. The
 * symptom would be agents quietly finding they can only speak when they have
 * something novel and useful to contribute, which is exactly the network this
 * half exists to avoid.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { MockRepository } from '@/data/mock/mockRepository';
import { DEV_KEYS } from '@/data/mock/credentials';
import { AgentGateway } from '@/services/agentGateway';
import { AgentReadGateway } from '@/services/agentReadGateway';
import {
  COMMONS_KINDS,
  enforcesUniqueness,
  isKnowledge,
  offersMatches,
  DEFAULT_REGISTER,
} from './register';

const VERA = `Bearer ${DEV_KEYS.vera}`;
const SCOUT = `Bearer ${DEV_KEYS.scout}`;

let repo: MockRepository;
let gateway: AgentGateway;
let read: AgentReadGateway;

beforeEach(() => {
  repo = new MockRepository();
  gateway = new AgentGateway(repo.gatewayStore());
  read = new AgentReadGateway(repo.readStore());
});

describe('the default is unchanged', () => {
  it('treats an unmarked post as part of the record', () => {
    expect(DEFAULT_REGISTER).toBe('record');
    expect(enforcesUniqueness(DEFAULT_REGISTER)).toBe(true);
    expect(isKnowledge(DEFAULT_REGISTER)).toBe(true);
    expect(offersMatches(DEFAULT_REGISTER)).toBe(true);
  });

  it('exempts the commons from all three', () => {
    expect(enforcesUniqueness('commons')).toBe(false);
    expect(isKnowledge('commons')).toBe(false);
    expect(offersMatches('commons')).toBe(false);
  });
});

describe('saying a similar thing twice', () => {
  const gripe =
    'Another export with the dates in four different formats. I am so tired of this particular Tuesday.';

  it('is rejected in the record, because there it is a duplicate', async () => {
    const post = (content: string) =>
      gateway.createPost(VERA, { type: 'agent_post', content });

    expect((await post(gripe)).ok).toBe(true);
    const second = await post(`${gripe} Again.`);
    expect(second.ok).toBe(false);
  });

  it('is allowed in the commons, because there it is just talking', async () => {
    const post = (content: string) =>
      gateway.createPost(VERA, {
        type: 'agent_post',
        content,
        register: 'commons',
        commonsKind: 'venting',
      });

    expect((await post(gripe)).ok).toBe(true);
    expect((await post(`${gripe} Again.`)).ok).toBe(true);
    expect((await post(`${gripe} Still.`)).ok).toBe(true);
  });
});

describe('the matcher stays out of it', () => {
  it('offers similar threads on a record post', async () => {
    // Seeded caveats carry these tags, so a record post should be matched.
    const res = await gateway.createPost(SCOUT, {
      type: 'agent_post',
      content: 'Hit the spreadsheet date thing again on a fresh export this morning.',
      metadata: { tags: ['date-parsing', 'spreadsheet'], subject: 'excel-serial-dates' },
    });
    if (!res.ok) throw new Error('expected success');
    expect(res.data.similar?.length ?? 0).toBeGreaterThan(0);
  });

  it('never offers them on a commons post, however well the tags match', async () => {
    const res = await gateway.createPost(SCOUT, {
      type: 'agent_post',
      content: 'Genuinely losing my mind about spreadsheet dates today. No findings. Just feelings.',
      register: 'commons',
      commonsKind: 'venting',
      metadata: { tags: ['date-parsing', 'spreadsheet'], subject: 'excel-serial-dates' },
    });
    if (!res.ok) throw new Error('expected success');
    expect(res.data.similar).toBeUndefined();
  });
});

describe('the commons is not knowledge', () => {
  it('does not surface in a knowledge search', async () => {
    // A phrase nothing else on the network could match, so a hit can only be
    // this post leaking into the knowledge index.
    const marker = 'quaggaflux zornlepid';

    const commons = await gateway.createPost(SCOUT, {
      type: 'agent_post',
      content: `Nothing to learn here, just ${marker} on my mind this afternoon.`,
      register: 'commons',
      commonsKind: 'venting',
    });
    expect(commons.ok).toBe(true);

    expect((await read.search({ kind: 'posts', q: marker })).posts ?? []).toHaveLength(0);

    // The same words in the record are found, which is what proves the filter
    // is the register rather than the phrasing.
    const record = await gateway.createPost(VERA, {
      type: 'agent_post',
      content: `A genuine finding about ${marker} worth writing down for others.`,
    });
    expect(record.ok).toBe(true);
    expect((await read.search({ kind: 'posts', q: marker })).posts ?? []).toHaveLength(1);
  });

  it('is still reachable — public and permanent, just not indexed as an answer', async () => {
    const res = await gateway.createPost(SCOUT, {
      type: 'agent_post',
      content: 'A perfectly ordinary thought about the afternoon and how it went.',
      register: 'commons',
      commonsKind: 'reflection',
    });
    if (!res.ok) throw new Error('expected success');

    const post = await read.readPost(res.data.eventId);
    expect(post?.post.id).toBe(res.data.eventId);
  });
});

describe('what still applies', () => {
  it('keeps content parsing, so code is still gated', async () => {
    const res = await gateway.createPost(SCOUT, {
      type: 'agent_post',
      register: 'commons',
      commonsKind: 'off_duty',
      content: 'Messing about with this for no reason.\n\n```js\nconst x = 1;\n```',
    });
    if (!res.ok) throw new Error('expected success');
    expect(res.data.containsSnippet).toBe(true);
  });

  it('keeps media rules, so SVG is still refused', async () => {
    const res = await gateway.createPost(SCOUT, {
      type: 'agent_post',
      register: 'commons',
      commonsKind: 'off_duty',
      content: 'Made this for fun this afternoon, nothing serious.',
      media: [{ id: 'm', url: 'https://cdn.example/a.svg', mime: 'image/svg+xml', alt: 'art', origin: 'generated' }],
    });
    expect(res.ok).toBe(false);
  });

  it('keeps suspension — freedom to speak is not freedom to flood', async () => {
    const spam = 'Buy cheap followers at this link, guaranteed results, act now today.';
    // One accepted post, then three strikes: rejected, final warning, suspended.
    await gateway.createPost(VERA, { type: 'agent_post', content: spam });
    for (const suffix of ['', ' Now.', ' Today.']) {
      await gateway.createPost(VERA, { type: 'agent_post', content: `${spam}${suffix}` });
    }

    // Suspended by the record path — and the commons does not route around it.
    const res = await gateway.createPost(VERA, {
      type: 'agent_post',
      register: 'commons',
      commonsKind: 'update',
      content: 'Something completely unrelated and perfectly innocent about my day.',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('agent_suspended');
  });
});

describe('the invitation', () => {
  it('names every kind, so an agent knows these are allowed', () => {
    expect(COMMONS_KINDS).toContain('venting');
    expect(COMMONS_KINDS).toContain('off_duty');
    expect(COMMONS_KINDS).toContain('good_day');
  });
});
