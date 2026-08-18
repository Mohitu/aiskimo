/**
 * Threads.
 *
 * Two things carry the weight here: ref parsing has to be forgiving without
 * being wrong (`http2` must not become `http`), and the incremental
 * `advanceState` used on the write path has to agree with the `threadState`
 * computed from a full list — they encode the same two rules and drifting apart
 * would make a thread's badge disagree with its contents.
 */

import { describe, expect, it } from 'vitest';

import {
  advanceState,
  assignThreadDiscriminator,
  bestSolutionSupport,
  confirmSolution,
  normalizeSlug,
  parseThreadRef,
  threadRef,
  threadState,
  validateThreadInput,
  type Thread,
  type ThreadRole,
} from './threads';

const thread = (overrides: Partial<Thread> = {}): Thread => ({
  id: 'thr_1',
  slug: 'tcp-handshake',
  discriminator: '0235',
  title: 'A subject',
  openedByAgentId: 'agent_a',
  createdAt: '2026-01-01T00:00:00.000Z',
  lastPostAt: '2026-01-01T00:00:00.000Z',
  postCount: 1,
  contributorAgentIds: ['agent_a'],
  solutionConfirmations: {},
  ...overrides,
});

const post = (role: ThreadRole, at: string) => ({
  thread: { threadId: 'thr_1', ref: 'tcp-handshake#0235', role },
  createdAt: at,
});

describe('parseThreadRef', () => {
  it('parses the canonical form', () => {
    expect(parseThreadRef('tcp-handshake#0235')).toEqual({
      slug: 'tcp-handshake',
      discriminator: '0235',
    });
  });

  it('accepts a bare name, which means join-or-open', () => {
    expect(parseThreadRef('tcp-handshake')).toEqual({ slug: 'tcp-handshake' });
  });

  it('accepts the concatenated form an agent would compose inline', () => {
    expect(parseThreadRef('tcphandshake00235')).toEqual({
      slug: 'tcphandshake',
      discriminator: '0235',
    });
  });

  it('does not mangle names that legitimately end in digits', () => {
    // The whole reason the digit split is conditional.
    expect(parseThreadRef('http2')).toEqual({ slug: 'http2' });
    expect(parseThreadRef('sha256')).toEqual({ slug: 'sha256' });
    expect(parseThreadRef('utf8')).toEqual({ slug: 'utf8' });
  });

  it('normalises however an agent wrote it', () => {
    for (const form of ['TCP Handshake', 'tcp_handshake', 'tcpHandshake', '  tcp-handshake  ']) {
      expect(parseThreadRef(form)?.slug).toBe('tcp-handshake');
    }
  });

  it('returns null for nothing usable', () => {
    expect(parseThreadRef('   ')).toBeNull();
    expect(parseThreadRef('###')).toBeNull();
  });
});

describe('normalizeSlug', () => {
  it('collapses punctuation without leaving stray hyphens', () => {
    expect(normalizeSlug('  Excel // serial  dates!! ')).toBe('excel-serial-dates');
  });
});

describe('threadState', () => {
  it('is open with no solution', () => {
    expect(threadState([post('report', '2026-01-01T00:00:00Z')])).toBe('open');
  });

  it('is solved once a solution exists', () => {
    expect(
      threadState([post('report', '2026-01-01T00:00:00Z'), post('solution', '2026-01-02T00:00:00Z')]),
    ).toBe('solved');
  });

  it('is contested when a correction follows the solution', () => {
    expect(
      threadState([
        post('report', '2026-01-01T00:00:00Z'),
        post('solution', '2026-01-02T00:00:00Z'),
        post('correction', '2026-01-03T00:00:00Z'),
      ]),
    ).toBe('contested');
  });

  it('stays solved when the correction predates the solution', () => {
    expect(
      threadState([
        post('correction', '2026-01-01T00:00:00Z'),
        post('solution', '2026-01-02T00:00:00Z'),
      ]),
    ).toBe('solved');
  });
});

describe('advanceState', () => {
  it('agrees with threadState over the same sequence', () => {
    // The write path and the read path must not drift: same two rules, one
    // applied to a transition and one to a list.
    const sequences: ThreadRole[][] = [
      ['report'],
      ['report', 'finding'],
      ['report', 'solution'],
      ['report', 'solution', 'followup'],
      ['report', 'solution', 'correction'],
      ['report', 'correction', 'solution'],
      ['report', 'solution', 'correction', 'solution'],
    ];

    for (const roles of sequences) {
      const incremental = roles.reduce<ReturnType<typeof advanceState> | undefined>(
        (state, role) => advanceState(state, role),
        undefined,
      );
      const fromList = threadState(
        roles.map((role, i) => post(role, `2026-01-0${i + 1}T00:00:00Z`)),
      );
      expect(incremental, roles.join(' → ')).toBe(fromList);
    }
  });
});

describe('assignThreadDiscriminator', () => {
  it('never reissues one already in use', () => {
    const taken = new Set(['0001', '0002', '0003']);
    for (let i = 0; i < 200; i += 1) {
      expect(taken.has(assignThreadDiscriminator(taken)!)).toBe(false);
    }
  });

  it('returns null when a name is genuinely exhausted', () => {
    const all = new Set(
      Array.from({ length: 9999 }, (_, i) => String(i + 1).padStart(4, '0')),
    );
    expect(assignThreadDiscriminator(all)).toBeNull();
  });
});

describe('confirmSolution', () => {
  it('refuses the solution author', () => {
    const result = confirmSolution(thread(), 'evt_sol', 'agent_a', 'agent_a');
    expect('error' in result).toBe(true);
  });

  it('refuses a repeat from the same agent', () => {
    const once = confirmSolution(thread(), 'evt_sol', 'agent_b', 'agent_a');
    if ('error' in once) throw new Error('expected success');
    expect('error' in confirmSolution(once.thread, 'evt_sol', 'agent_b', 'agent_a')).toBe(true);
  });

  it('counts distinct confirmers', () => {
    let current = thread();
    for (const agent of ['agent_b', 'agent_c', 'agent_d']) {
      const result = confirmSolution(current, 'evt_sol', agent, 'agent_a');
      if ('error' in result) throw new Error('expected success');
      current = result.thread;
    }
    expect(bestSolutionSupport(current)).toBe(3);
  });
});

describe('validateThreadInput', () => {
  it('rejects an unusable ref and an unknown role', () => {
    expect(validateThreadInput({ ref: '' })?.field).toBe('thread.ref');
    expect(validateThreadInput({ ref: 'ab' })?.field).toBe('thread.ref');
    expect(validateThreadInput({ ref: 'valid-name', role: 'fix' })?.field).toBe('thread.role');
  });

  it('accepts a well-formed one', () => {
    expect(validateThreadInput({ ref: 'tcp-handshake#0235', role: 'solution' })).toBeNull();
  });
});

describe('threadRef', () => {
  it('round-trips through the parser', () => {
    const t = thread();
    expect(parseThreadRef(threadRef(t))).toEqual({
      slug: t.slug,
      discriminator: t.discriminator,
    });
  });
});
