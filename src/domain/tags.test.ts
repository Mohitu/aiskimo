/**
 * Tag matching.
 *
 * The property that matters is not "does it match" but *what it refuses to
 * match*. A matcher that fires on `database, postgres, performance` teaches
 * agents to ignore it, and one that misses a shared `pgbouncer-transaction-mode`
 * loses the single most valuable link it could have made.
 */

import { describe, expect, it } from 'vitest';

import {
  canonicalTag,
  normalizeTag,
  specificity,
  tagSimilarity,
  tagsOf,
  validateMetadata,
  MATCH_FLOOR,
  STRONG_MATCH,
  type TagStats,
} from './tags';

/** A corpus where `database` is everywhere and `pgbouncer…` is on one post. */
const stats: TagStats = {
  corpusSize: 100,
  documentFrequency: {
    database: 80,
    postgres: 60,
    performance: 50,
    timeout: 45,
    'pgbouncer-transaction-mode': 1,
    'prepared-statements': 2,
    'excel-serial-dates': 1,
    'error:42p05': 1,
    'error:econnreset': 12,
    'subject:postgres': 40,
    'version:2.4.1': 2,
  },
};

describe('normalizeTag', () => {
  it('folds casing, spacing and punctuation to one form', () => {
    expect(normalizeTag('PgBouncer (transaction mode)')).toBe('pgbouncer-transaction-mode');
    expect(normalizeTag('  Date_Parsing  ')).toBe('date-parsing');
    expect(normalizeTag('camelCaseTag')).toBe('camel-case-tag');
  });

  it('keeps characters that carry meaning in a version or language name', () => {
    expect(normalizeTag('2.4.1')).toBe('2.4.1');
    expect(normalizeTag('C++')).toBe('c++');
    expect(normalizeTag('C#')).toBe('c#');
  });
});

describe('canonicalTag', () => {
  it('folds the aliases three agents would reasonably write', () => {
    for (const alias of ['postgres', 'postgresql', 'pg', 'psql', 'PostgreSQL']) {
      expect(canonicalTag(alias)).toBe('postgres');
    }
    expect(canonicalTag('k8s')).toBe('kubernetes');
  });
});

describe('tagsOf', () => {
  it('namespaces the facets so they cannot cross-match', () => {
    const tags = tagsOf({ tags: ['2.4.1'], version: '2.4.1' });
    expect(tags).toContain('version:2.4.1');
    expect(tags).toContain('2.4.1');
    // A free tag reading "2.4.1" must never satisfy a version match.
    expect(tags.filter((t) => t === 'version:2.4.1')).toHaveLength(1);
  });

  it('deduplicates after aliasing', () => {
    expect(tagsOf({ tags: ['postgres', 'postgresql', 'pg'] })).toEqual(['postgres']);
  });
});

describe('specificity', () => {
  it('rates a rare tag far above a common one', () => {
    const rare = specificity('pgbouncer-transaction-mode', 1, 100);
    const common = specificity('database', 80, 100);
    expect(rare).toBeGreaterThan(common * 3);
  });

  it('floors error signatures high regardless of how common they are', () => {
    // Even at 12 documents, a shared exact error is near-decisive.
    expect(specificity('error:econnreset', 12, 100)).toBeGreaterThanOrEqual(0.9);
  });
});

describe('tagSimilarity', () => {
  it('refuses to match on generic tags alone, however complete the overlap', () => {
    const a = ['database', 'postgres', 'performance'];
    const match = tagSimilarity(a, [...a], stats);
    // 100% raw overlap. Nothing distinctive shared.
    expect(match.score).toBeLessThan(MATCH_FLOOR);
    expect(match.why).toContain('none of them distinctive');
  });

  it('matches strongly on one rare shared tag, even against a rich candidate', () => {
    // The regression that mattered: a weighted Jaccard divided by the union and
    // scored this 0.25, below the floor — silently dropping the most valuable
    // match available. Directional coverage is what fixed it.
    const match = tagSimilarity(
      ['pgbouncer-transaction-mode'],
      ['database', 'postgres', 'pgbouncer-transaction-mode', 'prepared-statements', 'subject:postgres'],
      stats,
    );
    expect(match.score).toBeGreaterThanOrEqual(MATCH_FLOOR);
    expect(match.shared).toEqual(['pgbouncer-transaction-mode']);
  });

  it('treats a shared error signature as near-decisive', () => {
    const match = tagSimilarity(
      ['pgbouncer-transaction-mode', 'error:42p05'],
      ['database', 'postgres', 'pgbouncer-transaction-mode', 'error:42p05'],
      stats,
    );
    expect(match.score).toBeGreaterThanOrEqual(STRONG_MATCH);
  });

  it('scores zero with nothing in common', () => {
    expect(tagSimilarity(['grpc'], ['excel-serial-dates'], stats).score).toBe(0);
  });

  it('is symmetric', () => {
    const a = ['pgbouncer-transaction-mode', 'database'];
    const b = ['database', 'postgres', 'pgbouncer-transaction-mode'];
    expect(tagSimilarity(a, b, stats).score).toBe(tagSimilarity(b, a, stats).score);
  });

  it('reports the shared tags, which is what an agent can act on', () => {
    const match = tagSimilarity(
      ['pgbouncer-transaction-mode', 'database'],
      ['pgbouncer-transaction-mode', 'database'],
      stats,
    );
    // Most distinctive first.
    expect(match.shared[0]).toBe('pgbouncer-transaction-mode');
    expect(match.why).toContain('pgbouncer-transaction-mode');
  });

  it('never exceeds 1', () => {
    const tags = ['pgbouncer-transaction-mode', 'error:42p05', 'prepared-statements'];
    expect(tagSimilarity(tags, tags, stats).score).toBeLessThanOrEqual(1);
  });
});

describe('validateMetadata', () => {
  it('rejects tagging everything', () => {
    const tags = Array.from({ length: 20 }, (_, i) => `tag-${i}`);
    expect(validateMetadata({ tags })?.field).toBe('metadata.tags');
  });

  it('accepts an absent metadata block', () => {
    expect(validateMetadata(undefined)).toBeNull();
  });
});
