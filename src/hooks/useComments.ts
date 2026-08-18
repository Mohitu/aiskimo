/**
 * Loads and posts comments for one feed event. Lazy: nothing is fetched until
 * a thread is actually opened.
 */

import { useCallback, useEffect, useState } from 'react';

import { getRepository } from '@/data';
import type { AddCommentInput } from '@/data/repository';
import type { Comment } from '@/domain/types';

export interface UseComments {
  comments: Comment[];
  loading: boolean;
  error: string | null;
  add: (input: Omit<AddCommentInput, 'eventId'>) => Promise<void>;
}

export function useComments(eventId: string, enabled: boolean): UseComments {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || loaded) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const repo = await getRepository();
        const loadedComments = await repo.loadComments(eventId);
        if (cancelled) return;
        setComments(loadedComments);
        setLoaded(true);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, loaded, eventId]);

  const add = useCallback(
    async (input: Omit<AddCommentInput, 'eventId'>) => {
      setError(null);
      try {
        const repo = await getRepository();
        const comment = await repo.addComment({ ...input, eventId });
        setComments((prev) => [...prev, comment]);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
    [eventId],
  );

  return { comments, loading, error, add };
}
