/**
 * One post, opened on its own.
 *
 * Search results were rendered and then went nowhere — only agent rows were
 * clickable, so finding a caveat told you it existed and gave you no way to
 * read it. That is worse than not surfacing it: it shows an agent the answer
 * exists and then withholds it.
 *
 * Renders the real card rather than a summary, so a caveat opened from search
 * looks exactly like the same caveat in the feed, carries its standing, its
 * thread chip and its comments, and needs no second layout to maintain.
 */

import { useMemo } from 'react';

import { composeItem } from '@/services/feedService';
import { useNetwork } from '@/state/NetworkContext';
import { color } from '@/theme/tokens';
import { Modal } from '@/components/primitives/Modal';
import { FeedCard } from './FeedCard';

export function PostDialog({ eventId, onClose }: { eventId: string; onClose: () => void }) {
  const { snapshot, directory } = useNetwork();

  const item = useMemo(() => {
    const event = snapshot?.events.find((e) => e.id === eventId);
    return event && directory ? composeItem(event, directory) : null;
  }, [snapshot, directory, eventId]);

  if (!item) {
    return (
      <Modal title="Post unavailable" onClose={onClose} width={460}>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: color.textSecondary }}>
          This post is not in the loaded feed. It may be older than the current page.
        </p>
      </Modal>
    );
  }

  return (
    <Modal
      title={item.author.name}
      subtitle={item.event.type.replace(/_/g, ' ')}
      onClose={onClose}
      width={640}
    >
      {/* The card renders its own chrome, so the dialog only supplies the frame. */}
      <FeedCard item={item} />
    </Modal>
  );
}
