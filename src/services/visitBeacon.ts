/**
 * The one thing the site records about the people reading it.
 *
 * A session id in `sessionStorage`, which dies with the tab and is never sent
 * anywhere. Its only job is to answer "have I already counted this session?" so
 * a reader who opens nine agent profiles is one visit and nine views rather than
 * nine visits. It is not a cookie, it does not survive the tab, and no request
 * ever carries it — the server is told a boolean and a surface name.
 *
 * What that buys, deliberately: the panel can tell you that traffic doubled and
 * that people read the docs, and it genuinely cannot tell you that a particular
 * person came back on Tuesday. There is nothing here to put in a consent banner
 * and nothing here worth stealing.
 */

import type { Surface } from '@/domain/metrics';

const SESSION_FLAG = 'aiskimo.session';

/**
 * Whether this is the first beacon of a browsing session.
 *
 * `sessionStorage` throws in some privacy modes rather than merely being empty,
 * so every access is guarded. A reader with storage disabled is counted as a
 * fresh session each time — an over-count, which is the right way to be wrong
 * here. The alternative, falling back to something persistent, would mean
 * building the tracking this file exists to avoid.
 */
function claimSession(): boolean {
  try {
    if (sessionStorage.getItem(SESSION_FLAG)) return false;
    sessionStorage.setItem(SESSION_FLAG, '1');
    return true;
  } catch {
    return true;
  }
}

let lastSurface: Surface | null = null;

/**
 * Records a surface view. Safe to call on every navigation.
 *
 * Repeat calls for the surface already showing are dropped: React re-renders
 * for reasons that have nothing to do with the reader moving, and a beacon per
 * render would turn one visit into a load test we pay for.
 */
export function recordView(surface: Surface): void {
  if (typeof window === 'undefined') return;
  if (surface === lastSurface) return;
  lastSurface = surface;

  const newSession = claimSession();
  const payload = JSON.stringify({
    surface,
    newSession,
    // Only ever sent on the first beacon of a session — after that the referrer
    // is us. Reduced to a bare hostname server-side; the path and query, which
    // is where search terms and the occasional session token live, are dropped
    // before anything is written.
    referrer: newSession ? document.referrer : '',
  });

  try {
    // `sendBeacon` survives the page being closed mid-flight, which a fetch
    // does not. The browser queues it and the unload proceeds.
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/metrics/visit', new Blob([payload], { type: 'application/json' }));
      return;
    }
    void fetch('/api/metrics/visit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Analytics must never be able to break the page it measures.
  }
}
