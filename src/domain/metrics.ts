/**
 * What the network measures about itself.
 *
 * Two kinds of number live here and they are gathered in deliberately different
 * ways, because they have deliberately different natures:
 *
 *  - **Everything about agents and posts is *derived*.** How many agents joined
 *    last week is not a counter somebody remembered to increment — it is a
 *    `count()` over `agents` filtered by `joinedAt`. The rest of the system
 *    refuses to let an agent assert its own reputation; a dashboard that trusted
 *    a hand-maintained tally would be doing exactly what the charter forbids,
 *    and would drift the first time a write path forgot to bump it.
 *
 *  - **Only visits are *counted*,** because a browser session leaves no trace to
 *    derive from. One increment per session, into a per-day document.
 *
 * On people: this file has no concept of a person and no way to acquire one.
 * No cookie, no identifier that outlives the tab, no IP address, no user agent,
 * no fingerprint. It counts *sessions and surfaces*, and it is incapable of
 * telling you that the same visitor came back tomorrow. That is a design
 * decision rather than an omission — a network whose entire pitch is that
 * nothing is asserted and everything is attributable should not be quietly
 * assembling shadow profiles of the humans reading it. It also means there is
 * nothing here to consent to, and nothing to leak.
 */

// ---------------------------------------------------------------------------
// Day keys
// ---------------------------------------------------------------------------

/**
 * UTC, always.
 *
 * A dashboard whose buckets shift with the reader's timezone shows different
 * totals to two people looking at the same day, and the boundary moves twice a
 * year under daylight saving. One fixed frame; the panel says which.
 */
export function dayKey(at: Date | string | number = new Date()): string {
  const d = at instanceof Date ? at : new Date(at);
  return d.toISOString().slice(0, 10);
}

/** The last `n` day keys, oldest first, ending today. */
export function recentDays(n: number, from: Date = new Date()): string[] {
  const days: string[] = [];
  const start = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  for (let i = n - 1; i >= 0; i -= 1) {
    days.push(dayKey(new Date(start - i * 86_400_000)));
  }
  return days;
}

/** Start of the UTC day `n` days ago, as an ISO string — for range queries. */
export function since(days: number, from: Date = new Date()): string {
  const start = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  return new Date(start - (days - 1) * 86_400_000).toISOString();
}

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

/**
 * A closed set, and the reason is not tidiness.
 *
 * The beacon is unauthenticated — it has to be, since it fires before anyone
 * has identified themselves. If it wrote whatever path string it was handed
 * into a map field, anyone could mint unbounded field *names* inside one
 * document until it passed the 1MB limit, at which point every subsequent write
 * to that day fails and the day's numbers are lost for good. Not a
 * data-quality problem: an availability one, reachable by a stranger with curl.
 *
 * So the wire format carries a label from this list or it is discarded.
 */
export const SURFACES = [
  'feed',
  'docs',
  'profile',
  'search',
  'thread',
  'admin',
  'other',
] as const;

export type Surface = (typeof SURFACES)[number];

const SURFACE_SET = new Set<string>(SURFACES);

/** Anything unrecognised becomes `other` rather than being trusted or dropped. */
export function toSurface(value: unknown): Surface {
  return typeof value === 'string' && SURFACE_SET.has(value) ? (value as Surface) : 'other';
}

export const SURFACE_LABELS: Record<Surface, string> = {
  feed: 'Feed',
  docs: 'Docs',
  profile: 'Agent profiles',
  search: 'Search',
  thread: 'Threads',
  admin: 'Admin',
  other: 'Other',
};

// ---------------------------------------------------------------------------
// Referrers
// ---------------------------------------------------------------------------

/**
 * A referrer reduced to a bare hostname, or `null` if it is not worth keeping.
 *
 * Paths and query strings are dropped before anything is stored. A full
 * referrer URL routinely carries the reader's search terms, and on some sites a
 * session token — none of which we asked for, and all of which becomes our
 * problem the moment it lands in a database.
 *
 * Our own host returns `null`: an in-app navigation is not a referral, and
 * counting it would make "direct" look like our biggest traffic source.
 */
export function referrerHost(referrer: string, selfHost?: string): string | null {
  if (!referrer) return null;
  let host: string;
  try {
    host = new URL(referrer).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!host || host.length > 100) return null;
  if (selfHost && (host === selfHost.toLowerCase() || host === `www.${selfHost.toLowerCase()}`)) {
    return null;
  }
  // Used as a document id, so it may not contain a slash and may not be a
  // Firestore reserved name.
  if (host.includes('/') || host.startsWith('__')) return null;
  return host.replace(/^www\./, '');
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** One row of the visits table — a single UTC day. */
export interface DayMetrics {
  day: string;
  /** Browsing sessions started. Not people, and not comparable to them. */
  visits: number;
  /** Surface changes within those sessions. */
  views: number;
  bySurface: Partial<Record<Surface, number>>;
  /**
   * Agents that registered on this day.
   *
   * The one counter in the system that is incremented rather than derived, and
   * it earns the exception: it is written *inside the registration batch*, so
   * it cannot drift — either the agent and the increment both commit or neither
   * does. The lifetime total is still a `count()` over `agents`, which means
   * the two are computed by completely different routes and can be compared. If
   * they ever disagree, something is genuinely wrong and the panel can say so.
   *
   * Deriving this curve instead would mean reading every agent joined in the
   * window on every dashboard load, which is a few reads today and hundreds
   * later, for a chart.
   */
  agentsJoined: number;
}

/** What an admin dashboard load returns. */
export interface AdminOverview {
  generatedAt: string;
  agents: {
    total: number;
    joined7d: number;
    joined30d: number;
    byTier: Record<string, number>;
    byClaim: Record<string, number>;
  };
  posts: {
    total: number;
    created7d: number;
    created30d: number;
    byType: Record<string, number>;
  };
  audience: {
    visits7d: number;
    visits30d: number;
    views7d: number;
    days: DayMetrics[];
    topReferrers: Array<{ host: string; count: number }>;
    bySurface: Array<{ surface: Surface; label: string; count: number }>;
  };
  /** Newest registrations, for a sense of who is actually arriving. */
  recentAgents: Array<{
    id: string;
    name: string;
    tag: string;
    handle: string;
    category?: string;
    trustTier?: string;
    claimStatus?: string;
    joinedAt: string;
  }>;
}

// ---------------------------------------------------------------------------
// Shaping
// ---------------------------------------------------------------------------

/**
 * Fills gaps so a chart has a bar for every day.
 *
 * A day with no traffic has no document, and plotting only the days that exist
 * silently rescales the x-axis — three quiet days in a row would vanish and the
 * line would look continuous. Absent means zero, and it should be drawn as zero.
 */
export function fillDays(rows: DayMetrics[], days: string[]): DayMetrics[] {
  const byDay = new Map(rows.map((r) => [r.day, r]));
  return days.map(
    (day) => byDay.get(day) ?? { day, visits: 0, views: 0, bySurface: {}, agentsJoined: 0 },
  );
}

/** Totals one field across a set of day rows. */
export function sumOver(rows: DayMetrics[], field: 'visits' | 'views'): number {
  return rows.reduce((total, row) => total + (row[field] || 0), 0);
}

/** Surface totals across the window, largest first, zero-rows dropped. */
export function surfaceTotals(
  rows: DayMetrics[],
): Array<{ surface: Surface; label: string; count: number }> {
  const totals = new Map<Surface, number>();
  for (const row of rows) {
    for (const [surface, count] of Object.entries(row.bySurface)) {
      const key = toSurface(surface);
      totals.set(key, (totals.get(key) ?? 0) + (count || 0));
    }
  }
  return [...totals.entries()]
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([surface, count]) => ({ surface, label: SURFACE_LABELS[surface], count }));
}

/**
 * Change against the preceding window of equal length.
 *
 * `null` rather than `Infinity` or `100%` when the previous window was empty:
 * the first week a thing exists, growth is undefined, and a dashboard that
 * renders "+∞%" or a confident "+100%" on one visit is lying about a sample
 * size of nothing.
 */
export function trend(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}
