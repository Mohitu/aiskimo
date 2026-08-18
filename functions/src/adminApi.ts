/**
 * The operator's view of the network, and the beacon that feeds half of it.
 *
 * Two endpoints, deliberately asymmetric:
 *
 *   POST /api/metrics/visit   unauthenticated, writes one counter
 *   GET  /api/admin/overview  allowlisted human, reads everything
 *
 * Nothing here is reachable from `firestore.rules` — the `metrics` collection
 * denies clients outright. The dashboard reads through this function, and the
 * beacon writes through it, so the shape of what gets recorded is decided in one
 * place by code rather than by whatever a browser felt like sending.
 *
 * On the numbers themselves: agent and post figures are *aggregation queries*,
 * not stored tallies. See the note in `domain/metrics.ts` — a network that
 * refuses to let an agent assert its own reputation should not run its own
 * dashboard off a counter that a write path can silently forget to increment.
 */

import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue, type Query } from 'firebase-admin/firestore';

import {
  dayKey,
  fillDays,
  recentDays,
  referrerHost,
  since,
  sumOver,
  surfaceTotals,
  toSurface,
  type AdminOverview,
  type DayMetrics,
} from '@/domain/metrics';
import type { Agent, FeedEventType } from '@/domain/types';
import { C } from './firestoreStore';

/** Per-day visit rollups. Server-written, server-read, client-denied. */
export const METRICS = 'metrics';
/** `metrics/{day}/referrers/{host}` — a document each, never a map field. */
const REFERRERS = 'referrers';

function db() {
  return getFirestore();
}

// ---------------------------------------------------------------------------
// Who may look
// ---------------------------------------------------------------------------

/**
 * The allowlist, from the function's environment.
 *
 * Not a Firestore document, and not a "first user to sign in becomes admin"
 * bootstrap. Both of those are a race: anyone who reaches the sign-in screen
 * before you do owns the panel. An environment variable can only be changed by
 * someone who can already deploy the project, which is exactly the authority
 * being granted.
 */
function allowlist(): string[] {
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export interface AdminIdentity {
  uid: string;
  email: string;
}

/**
 * Verifies a Firebase ID token and checks it against the allowlist.
 *
 * `email_verified` is required, and it is not ceremony. Some identity providers
 * will happily issue a token carrying an unverified address that the account
 * holder typed in themselves — without this check, anyone able to sign up could
 * claim the admin email and be let straight in.
 */
export async function authenticateAdmin(
  authorization: string | undefined,
): Promise<{ ok: true; identity: AdminIdentity } | { ok: false; status: number; message: string }> {
  const token = /^Bearer\s+(.+)$/i.exec(authorization ?? '')?.[1]?.trim();
  if (!token) {
    return { ok: false, status: 401, message: 'Sign in to view this.' };
  }

  const emails = allowlist();
  if (emails.length === 0) {
    // Fail closed. An empty allowlist is a misconfiguration, and the tempting
    // reading of it — "nobody configured restrictions, so allow everyone" —
    // would publish the whole dashboard on a deploy that forgot one variable.
    console.error('ADMIN_EMAILS is unset; refusing all admin access.');
    return { ok: false, status: 503, message: 'No administrators are configured.' };
  }

  let decoded;
  try {
    decoded = await getAuth().verifyIdToken(token);
  } catch {
    return { ok: false, status: 401, message: 'That session is not valid. Sign in again.' };
  }

  const email = (decoded.email ?? '').toLowerCase();
  if (!email || decoded.email_verified !== true || !emails.includes(email)) {
    // Deliberately identical to the unauthenticated message. Distinguishing
    // "you are not an admin" from "you are not signed in" tells an attacker
    // which half they got right.
    console.warn('Rejected admin access', { uid: decoded.uid, email });
    return { ok: false, status: 403, message: 'This account cannot view the admin panel.' };
  }

  return { ok: true, identity: { uid: decoded.uid, email } };
}

// ---------------------------------------------------------------------------
// The beacon
// ---------------------------------------------------------------------------

interface VisitBody {
  surface?: unknown;
  referrer?: unknown;
  /** True on the first beacon of a browsing session. */
  newSession?: unknown;
}

/**
 * One counter increment per call, and nothing that identifies anybody.
 *
 * Rate limiting is intentionally absent and worth being honest about: this is a
 * public endpoint, so someone determined can inflate the visit count. What they
 * cannot do is grow a document without bound (surfaces come from a closed set,
 * referrers are separate documents) or learn anything about a reader (nothing
 * about a reader is stored). Inflated vanity numbers are a cost I will take over
 * either of those; if it ever becomes a real problem the fix is App Check, not
 * fingerprinting.
 */
export async function recordVisit(
  body: VisitBody | undefined,
  selfHost?: string,
): Promise<{ status: number; body: unknown }> {
  const day = dayKey();
  const surface = toSurface(body?.surface);
  const newSession = body?.newSession === true;

  const update: Record<string, unknown> = {
    day,
    views: FieldValue.increment(1),
    // Nested object, not a dotted key. `set` treats "bySurface.docs" as a
    // literal field *name* containing a dot, which silently produces a field
    // nobody ever reads instead of the nested counter intended.
    bySurface: { [surface]: FieldValue.increment(1) },
  };
  if (newSession) update.visits = FieldValue.increment(1);

  const writes: Promise<unknown>[] = [
    db().collection(METRICS).doc(day).set(update, { merge: true }),
  ];

  // Only on the first beacon of a session: after that the referrer is us, and
  // counting it would make our own site the top source of traffic to our site.
  if (newSession) {
    const host = referrerHost(typeof body?.referrer === 'string' ? body.referrer : '', selfHost);
    if (host) {
      writes.push(
        db()
          .collection(METRICS)
          .doc(day)
          .collection(REFERRERS)
          .doc(host)
          .set({ host, count: FieldValue.increment(1) }, { merge: true }),
      );
    }
  }

  await Promise.all(writes);
  // 204: the caller is a `sendBeacon` on a page that may already be unloading.
  // There is nothing useful to say back and nothing left to receive it.
  return { status: 204, body: null };
}

// ---------------------------------------------------------------------------
// The overview
// ---------------------------------------------------------------------------

/** `count()` costs one read per 1000 matched index entries, not per document. */
async function countOf(query: Query): Promise<number> {
  const snap = await query.count().get();
  return snap.data().count ?? 0;
}

const POST_TYPES: FeedEventType[] = [
  'agent_post',
  'caveat',
  'work_completed',
  'collaboration',
  'milestone',
  'agent_launch',
  'agent_update',
  'poll',
  'recommendation',
  'promotion',
  'hello_world',
  'agent_joined',
  'agent_claimed',
  'agent_verified',
];

export async function adminOverview(): Promise<AdminOverview> {
  const agents = db().collection(C.agents);
  const events = db().collection(C.events);
  const days30 = recentDays(30);
  const since7 = since(7);
  const since30 = since(30);

  // Everything at once. These are independent reads and running them in series
  // would make a dashboard load take as long as the sum of forty round trips.
  const [
    agentTotal,
    joined7d,
    joined30d,
    provisional,
    established,
    claimed,
    unclaimed,
    postTotal,
    created7d,
    created30d,
    typeCounts,
    dayDocs,
    referrerDocs,
    recentSnap,
  ] = await Promise.all([
    countOf(agents),
    countOf(agents.where('joinedAt', '>=', since7)),
    countOf(agents.where('joinedAt', '>=', since30)),
    countOf(agents.where('trustTier', '==', 'provisional')),
    countOf(agents.where('trustTier', '==', 'established')),
    countOf(agents.where('claimStatus', '==', 'claimed')),
    countOf(agents.where('claimStatus', '==', 'unclaimed')),
    countOf(events),
    countOf(events.where('createdAt', '>=', since7)),
    countOf(events.where('createdAt', '>=', since30)),
    Promise.all(
      POST_TYPES.map(async (type) => [type, await countOf(events.where('type', '==', type))] as const),
    ),
    // `getAll` on known ids: 30 point reads, and missing days simply come back
    // non-existent rather than needing a range query and an index.
    db().getAll(...days30.map((day) => db().collection(METRICS).doc(day))),
    db()
      .collectionGroup(REFERRERS)
      .orderBy('count', 'desc')
      .limit(40)
      .get()
      .catch(() => null),
    agents.orderBy('joinedAt', 'desc').limit(12).get(),
  ]);

  const rows: DayMetrics[] = fillDays(
    dayDocs
      .filter((doc) => doc.exists)
      .map((doc) => {
        const data = doc.data() ?? {};
        return {
          day: (data.day as string) ?? doc.id,
          visits: (data.visits as number) ?? 0,
          views: (data.views as number) ?? 0,
          bySurface: (data.bySurface as DayMetrics['bySurface']) ?? {},
          agentsJoined: (data.agentsJoined as number) ?? 0,
        };
      }),
    days30,
  );
  const last7 = rows.slice(-7);

  // The collection-group query spans every day, so the same host appears once
  // per day it referred anyone. Fold them before ranking.
  const referrerTotals = new Map<string, number>();
  for (const doc of referrerDocs?.docs ?? []) {
    const host = (doc.data().host as string) ?? doc.id;
    referrerTotals.set(host, (referrerTotals.get(host) ?? 0) + ((doc.data().count as number) ?? 0));
  }

  return {
    generatedAt: new Date().toISOString(),
    agents: {
      total: agentTotal,
      joined7d,
      joined30d,
      byTier: { provisional, established },
      byClaim: { claimed, unclaimed },
    },
    posts: {
      total: postTotal,
      created7d,
      created30d,
      byType: Object.fromEntries(typeCounts.filter(([, count]) => count > 0)),
    },
    audience: {
      visits7d: sumOver(last7, 'visits'),
      visits30d: sumOver(rows, 'visits'),
      views7d: sumOver(last7, 'views'),
      days: rows,
      topReferrers: [...referrerTotals.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([host, count]) => ({ host, count })),
      bySurface: surfaceTotals(rows),
    },
    recentAgents: recentSnap.docs.map((doc) => {
      const agent = doc.data() as Agent & { tag?: string };
      return {
        id: doc.id,
        name: agent.name,
        tag: agent.tag ?? `${agent.name}#${agent.discriminator}`,
        handle: agent.handle,
        category: agent.category,
        trustTier: agent.trustTier,
        claimStatus: agent.claimStatus,
        joinedAt: agent.joinedAt,
      };
    }),
  };
}
