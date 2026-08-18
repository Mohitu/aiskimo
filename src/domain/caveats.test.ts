/**
 * Caveat standing.
 *
 * The failure this guards against is subtle and expensive: a record of failures
 * that never decays becomes confidently wrong, and an agent routing around a
 * problem that was fixed a year ago loses more than it saved.
 */

import { describe, expect, it } from 'vitest';

import {
  caveatConfidence,
  confirmCaveat,
  describeAge,
  describeConfidence,
  disputeCaveat,
  newCaveatRecord,
  resolveCaveat,
  RESOLVED_CONFIDENCE,
  type CaveatRecord,
} from './caveats';

const NOW = new Date('2026-08-16T12:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

function record(overrides: Partial<CaveatRecord> = {}): CaveatRecord {
  return {
    ...newCaveatRecord('evt_1', 'agent_author', 'A subject', 'warning', daysAgo(0)),
    ...overrides,
  };
}

describe('caveatConfidence', () => {
  it('is full for something confirmed today', () => {
    expect(caveatConfidence(record(), NOW)).toBe(1);
  });

  it('decays steeply once unconfirmed for long enough', () => {
    const old = record({ lastConfirmedAt: daysAgo(730) });
    expect(caveatConfidence(old, NOW)).toBeLessThan(0.2);
  });

  it('never reaches zero — an old caveat is demoted, never deleted', () => {
    const ancient = record({ lastConfirmedAt: daysAgo(365 * 10) });
    expect(caveatConfidence(ancient, NOW)).toBeGreaterThan(0);
  });

  it('decays more slowly when several agents corroborated it', () => {
    const lonely = record({ lastConfirmedAt: daysAgo(400) });
    const corroborated = record({
      lastConfirmedAt: daysAgo(400),
      confirmations: [
        { agentId: 'a', at: daysAgo(400) },
        { agentId: 'b', at: daysAgo(400) },
        { agentId: 'c', at: daysAgo(400) },
      ],
    });
    expect(caveatConfidence(corroborated, NOW)).toBeGreaterThan(caveatConfidence(lonely, NOW) * 2);
  });

  it('is reduced by disputes but never argued out of existence', () => {
    const contested = record({
      disputes: [
        { agentId: 'a', at: daysAgo(1), note: 'no repro' },
        { agentId: 'b', at: daysAgo(1), note: 'no repro' },
        { agentId: 'c', at: daysAgo(1), note: 'no repro' },
        { agentId: 'd', at: daysAgo(1), note: 'no repro' },
      ],
    });
    const score = caveatConfidence(contested, NOW);
    expect(score).toBeLessThan(1);
    expect(score).toBeGreaterThanOrEqual(0.3);
  });

  it('floors a resolved caveat rather than zeroing it', () => {
    // Still the right answer for anyone pinned below the fix.
    expect(caveatConfidence(record({ status: 'resolved' }), NOW)).toBe(RESOLVED_CONFIDENCE);
  });
});

describe('confirmCaveat', () => {
  it('refuses the author — confirming your own proves nothing', () => {
    const result = confirmCaveat(record(), 'agent_author', NOW);
    expect('error' in result).toBe(true);
  });

  it('refuses a second confirmation from the same agent', () => {
    const once = confirmCaveat(record(), 'agent_other', NOW);
    if ('error' in once) throw new Error('expected success');
    expect('error' in confirmCaveat(once.record, 'agent_other', NOW)).toBe(true);
  });

  it('resets the decay clock', () => {
    const stale = record({ lastConfirmedAt: daysAgo(500) });
    expect(caveatConfidence(stale, NOW)).toBeLessThan(0.3);

    const result = confirmCaveat(stale, 'agent_other', NOW);
    if ('error' in result) throw new Error('expected success');
    expect(caveatConfidence(result.record, NOW)).toBe(1);
  });

  it('cancels an earlier dispute from the same agent — the later observation stands', () => {
    const disputed = record({ disputes: [{ agentId: 'agent_other', at: daysAgo(2), note: 'no repro' }] });
    const result = confirmCaveat(disputed, 'agent_other', NOW);
    if ('error' in result) throw new Error('expected success');
    expect(result.record.disputes).toHaveLength(0);
    expect(result.record.confirmations).toHaveLength(1);
  });

  it('refuses once the caveat is closed', () => {
    expect('error' in confirmCaveat(record({ status: 'resolved' }), 'agent_other', NOW)).toBe(true);
  });
});

describe('disputeCaveat', () => {
  it('requires a note — "could not reproduce" alone helps nobody', () => {
    expect('error' in disputeCaveat(record(), 'agent_other', '', NOW)).toBe(true);
  });

  it('never removes the caveat', () => {
    const result = disputeCaveat(record(), 'agent_other', 'Could not repro on 3.1', NOW);
    if ('error' in result) throw new Error('expected success');
    expect(result.record.status).toBe('open');
  });
});

describe('resolveCaveat', () => {
  it('is available only to the author', () => {
    const result = resolveCaveat(record(), 'agent_other', { status: 'resolved' }, NOW);
    expect('error' in result).toBe(true);
  });

  it('requires the replacement when superseding', () => {
    const result = resolveCaveat(record(), 'agent_author', { status: 'superseded' }, NOW);
    expect('error' in result).toBe(true);
  });

  it('records the fix', () => {
    const result = resolveCaveat(record(), 'agent_author', { status: 'resolved', fixedIn: '2.4.1' }, NOW);
    if ('error' in result) throw new Error('expected success');
    expect(result.record.fixedIn).toBe('2.4.1');
    expect(describeConfidence(result.record, NOW)).toContain('2.4.1');
  });
});

describe('describeAge', () => {
  it('says "filed" until somebody else has confirmed it', () => {
    expect(describeAge(record(), NOW)).toBe('Filed today');
  });

  it('says "confirmed" once corroborated', () => {
    const confirmed = record({ confirmations: [{ agentId: 'a', at: daysAgo(0) }] });
    expect(describeAge(confirmed, NOW)).toBe('Confirmed today');
  });

  it('flags anything old enough to be worth re-checking', () => {
    expect(describeAge(record({ lastConfirmedAt: daysAgo(200) }), NOW)).toContain('re-checking');
  });
});
