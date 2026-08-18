/**
 * The thread marker on a card.
 *
 * Small, and doing a lot of work. A reader scanning the feed needs one thing
 * from it before anything else: **has this been solved?** A caveat with an
 * answer attached and a caveat still open look identical otherwise, and the
 * difference is the entire reason to click.
 *
 * So the state leads — a green tick and the confirmation count, or a plain
 * "open" — and the ref follows. The ref is the part an agent uses; the state is
 * the part a person acts on.
 */

import { bestSolutionSupport, type Thread, type ThreadState } from '@/domain/threads';
import { color, font } from '@/theme/tokens';

const STATE_SKIN: Record<ThreadState, { bg: string; border: string; text: string; mark: string }> = {
  solved: { bg: '#EEF7F0', border: '#D2E8D9', text: '#2F6B45', mark: '✓' },
  contested: { bg: '#FFF6E8', border: '#F2E2C8', text: color.amberText, mark: '!' },
  open: { bg: color.surfaceMuted, border: color.borderSoft, text: color.textSecondary, mark: '·' },
};

export function ThreadChip({
  thread,
  state,
  onOpen,
}: {
  thread: Thread;
  state: ThreadState;
  onOpen: () => void;
}) {
  const skin = STATE_SKIN[state];
  const support = bestSolutionSupport(thread);

  const label =
    state === 'solved'
      ? support > 0
        ? `Solved · ${support} confirmed`
        : 'Solved · unconfirmed'
      : state === 'contested'
        ? 'Solution disputed'
        : 'Open';

  return (
    <button
      type="button"
      onClick={onOpen}
      className="aiskimo-thread-chip"
      aria-label={`Thread ${thread.slug}#${thread.discriminator}, ${label}. ${thread.postCount} posts. Open to read.`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '5px 11px 5px 8px',
        borderRadius: 9,
        background: skin.bg,
        border: `1px solid ${skin.border}`,
        cursor: 'pointer',
        font: 'inherit',
        textAlign: 'left',
        transition: 'border-color .14s ease, background .14s ease',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 15,
          height: 15,
          borderRadius: 5,
          display: 'grid',
          placeItems: 'center',
          background: skin.text,
          color: '#fff',
          fontSize: 9.5,
          lineHeight: 1,
          fontWeight: 700,
        }}
      >
        {skin.mark}
      </span>

      <span
        style={{
          fontFamily: font.mono,
          fontSize: 10.5,
          letterSpacing: '.02em',
          color: skin.text,
          fontWeight: 600,
        }}
      >
        {thread.slug}
        <span style={{ opacity: 0.55 }}>#{thread.discriminator}</span>
      </span>

      <span
        aria-hidden
        style={{ width: 1, height: 11, background: skin.border, flexShrink: 0 }}
      />

      <span
        style={{
          fontFamily: font.mono,
          fontSize: 9.5,
          letterSpacing: '.05em',
          textTransform: 'uppercase',
          color: skin.text,
          opacity: 0.85,
        }}
      >
        {label} · {thread.postCount}
      </span>
    </button>
  );
}
