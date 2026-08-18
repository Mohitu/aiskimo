import { describe, expect, it } from 'vitest';

import {
  dayKey,
  fillDays,
  recentDays,
  referrerHost,
  since,
  sumOver,
  surfaceTotals,
  toSurface,
  trend,
  type DayMetrics,
} from './metrics';

function day(partial: Partial<DayMetrics> & { day: string }): DayMetrics {
  return { visits: 0, views: 0, bySurface: {}, agentsJoined: 0, ...partial };
}

describe('day keys', () => {
  it('buckets by UTC, not by the reader’s clock', () => {
    // 23:30 in New York on the 5th is already the 6th in UTC. A dashboard that
    // used local time would show two people different totals for "today".
    expect(dayKey('2026-03-06T04:30:00.000Z')).toBe('2026-03-06');
    expect(dayKey('2026-03-05T23:59:59.999Z')).toBe('2026-03-05');
  });

  it('returns n days oldest-first, ending today', () => {
    const days = recentDays(5, new Date('2026-08-16T09:00:00Z'));
    expect(days).toEqual(['2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15', '2026-08-16']);
  });

  it('crosses a month boundary', () => {
    expect(recentDays(3, new Date('2026-03-01T12:00:00Z'))).toEqual([
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
    ]);
  });

  it('starts the window at midnight so a range query keeps whole days', () => {
    // Not "seven times 24 hours ago" — that would cut today's first hours out
    // of a seven-day count depending on when the dashboard happened to load.
    expect(since(7, new Date('2026-08-16T18:45:00Z'))).toBe('2026-08-10T00:00:00.000Z');
    expect(since(1, new Date('2026-08-16T18:45:00Z'))).toBe('2026-08-16T00:00:00.000Z');
  });
});

describe('surfaces', () => {
  it('keeps known labels', () => {
    expect(toSurface('docs')).toBe('docs');
  });

  it('folds anything unrecognised into `other` rather than trusting it', () => {
    // The beacon is unauthenticated. If arbitrary strings became map keys, a
    // stranger could grow one document past Firestore's 1MB limit, after which
    // every write to that day fails and the day's numbers are lost.
    expect(toSurface('../../etc/passwd')).toBe('other');
    expect(toSurface('')).toBe('other');
    expect(toSurface(42)).toBe('other');
    expect(toSurface(null)).toBe('other');
  });
});

describe('referrers', () => {
  it('keeps only the hostname', () => {
    expect(referrerHost('https://news.ycombinator.com/item?id=123')).toBe('news.ycombinator.com');
  });

  it('discards the path and query, where search terms and tokens live', () => {
    const host = referrerHost('https://www.google.com/search?q=secret+internal+project');
    expect(host).toBe('google.com');
    expect(host).not.toContain('secret');
  });

  it('drops our own host, so the site is not its own top referrer', () => {
    expect(referrerHost('https://aiskimo.com/docs', 'aiskimo.com')).toBeNull();
    expect(referrerHost('https://www.aiskimo.com/docs', 'aiskimo.com')).toBeNull();
  });

  it('rejects anything that is not a usable document id', () => {
    expect(referrerHost('')).toBeNull();
    expect(referrerHost('not a url')).toBeNull();
    expect(referrerHost(`https://${'a'.repeat(200)}.com/`)).toBeNull();
  });
});

describe('shaping', () => {
  it('draws a bar for a quiet day instead of dropping it', () => {
    // A missing document means zero traffic, not "no data". Plotting only the
    // days that exist silently rescales the axis and hides an outage.
    const filled = fillDays(
      [day({ day: '2026-08-14', visits: 9 })],
      ['2026-08-13', '2026-08-14', '2026-08-15'],
    );
    expect(filled.map((d) => d.visits)).toEqual([0, 9, 0]);
    expect(filled).toHaveLength(3);
  });

  it('totals a field across days', () => {
    expect(
      sumOver([day({ day: 'a', visits: 3 }), day({ day: 'b', visits: 4 })], 'visits'),
    ).toBe(7);
  });

  it('ranks surfaces and drops empty ones', () => {
    const totals = surfaceTotals([
      day({ day: 'a', bySurface: { feed: 5, docs: 2 } }),
      day({ day: 'b', bySurface: { docs: 9, profile: 0 } }),
    ]);
    expect(totals.map((t) => [t.surface, t.count])).toEqual([
      ['docs', 11],
      ['feed', 5],
    ]);
  });

  it('reports no trend rather than an invented one when there is no baseline', () => {
    // "+100%" off a previous window of zero is a statement about one visit.
    expect(trend(5, 0)).toBeNull();
    expect(trend(0, 0)).toBeNull();
    expect(trend(12, 10)).toBe(20);
    expect(trend(8, 10)).toBe(-20);
  });
});
