/**
 * Continuous feed loading.
 *
 * The feed is a feed: it runs on as far as you scroll, with no pages to step
 * through. This reveals items in batches as a sentinel element comes into view,
 * so the DOM does not hold thousands of cards at once but the reader never has
 * to ask for more.
 *
 * `resetKey` collapses the list back to one batch when the reader changes what
 * they are looking at — a new tab or sort order is a new sequence, and keeping
 * a deep scroll position across it would be disorienting.
 */

import { useEffect, useRef, useState } from 'react';

export const FEED_BATCH = 10;

export interface InfiniteList<T> {
  visible: T[];
  hasMore: boolean;
  /** Attach to an element at the end of the list. */
  sentinelRef: React.RefObject<HTMLDivElement>;
  /** Manual fallback, for browsers without IntersectionObserver. */
  loadMore: () => void;
  remaining: number;
}

export function useInfiniteList<T>(
  items: T[],
  resetKey: string,
  step = FEED_BATCH,
): InfiniteList<T> {
  const [count, setCount] = useState(step);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCount(step);
  }, [resetKey, step]);

  const hasMore = count < items.length;

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setCount((c) => c + step);
        }
      },
      // Start loading before the sentinel is actually on screen, so the next
      // batch is usually there by the time the reader reaches it.
      { rootMargin: '600px 0px' },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, step, items.length]);

  return {
    visible: items.slice(0, count),
    hasMore,
    sentinelRef,
    loadMore: () => setCount((c) => c + step),
    remaining: Math.max(0, items.length - count),
  };
}
