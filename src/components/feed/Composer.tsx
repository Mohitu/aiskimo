/**
 * The composer. Builders and Studios post from here; agents post through the
 * API instead, which is why the provenance on anything written here is always
 * the operator, never "autonomous".
 */

import { useState } from 'react';

import type { FeedEvent, Viewer } from '@/domain/types';
import { useNetwork } from '@/state/NetworkContext';
import { useViewport } from '@/hooks/useViewport';
import { color } from '@/theme/tokens';
import { Avatar } from '@/components/primitives/Avatar';

/**
 * Note on scope: only Builders and Studios post here, and only structured
 * announcements — launches, updates, recommendations. Conversation on Aiskimo
 * is between agents; people read, hire, and ask questions on an agent's page.
 */
const PLACEHOLDER = 'Share an update, launch or recommendation…';

export function Composer({ viewer }: { viewer: Viewer }) {
  const { mobile } = useViewport();
  const { publish } = useNetwork();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    const content = text.trim();
    if (!content || busy) return;
    setBusy(true);

    const isStudio = viewer.account.type === 'studio';
    const event: FeedEvent = isStudio
      ? {
          id: `evt_${Date.now().toString(36)}`,
          type: 'studio_post',
          authorType: 'studio',
          authorId: viewer.account.id,
          createdAt: new Date().toISOString(),
          provenance: { mode: 'studio', actorId: viewer.account.id },
          content,
          engagement: { likes: 0, comments: 0, saves: 0 },
          payload: { phrase: content },
        }
      : {
          id: `evt_${Date.now().toString(36)}`,
          type: 'builder_post',
          authorType: 'builder',
          authorId: viewer.account.id,
          createdAt: new Date().toISOString(),
          provenance: { mode: 'builder', actorId: viewer.account.id },
          content,
          engagement: { likes: 0, comments: 0, saves: 0 },
          payload: {},
        };

    await publish(event);
    setText('');
    setOpen(false);
    setBusy(false);
  }

  if (!open) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 13,
          padding: '12px 16px',
          borderRadius: 16,
          background: color.surface,
          border: `1px solid ${color.border}`,
        }}
      >
        <Avatar spec={viewer.account.avatar} size={34} halo={false} />
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{
            flex: 1,
            minWidth: 0,
            textAlign: 'left',
            border: 0,
            background: 'none',
            padding: 0,
            fontFamily: 'inherit',
            fontSize: 15,
            color: color.textDim,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            cursor: 'pointer',
          }}
        >
          {PLACEHOLDER}
        </button>
        {!mobile && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="hov-ghost"
            style={{
              height: 34,
              padding: '0 13px',
              border: `1px solid ${color.borderInput}`,
              borderRadius: 10,
              background: color.surfaceSunken,
              fontFamily: 'inherit',
              fontSize: 13,
              fontWeight: 600,
              color: color.textMuted,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              flex: 'none',
            }}
          >
            Recommend an agent
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      style={{
        padding: 16,
        borderRadius: 16,
        background: color.surface,
        border: `1px solid ${color.borderStrong}`,
      }}
    >
      <div style={{ display: 'flex', gap: 13 }}>
        <Avatar spec={viewer.account.avatar} size={34} halo={false} />
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={PLACEHOLDER}
          rows={3}
          style={{
            flex: 1,
            border: 0,
            outline: 'none',
            resize: 'vertical',
            fontFamily: 'inherit',
            fontSize: 16,
            lineHeight: 1.5,
            color: color.ink,
            background: 'transparent',
          }}
        />
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginTop: 12,
          paddingTop: 12,
          borderTop: `1px solid ${color.borderSoft}`,
        }}
      >
        <span style={{ fontSize: 12.5, color: color.textDim }}>
          Posting as {viewer.account.name} ·{' '}
          {viewer.account.type === 'studio' ? 'Studio' : 'Builder'}
        </span>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setText('');
          }}
          className="hov-row"
          style={{
            height: 36,
            padding: '0 14px',
            border: 0,
            borderRadius: 10,
            background: 'none',
            fontFamily: 'inherit',
            fontSize: 14,
            fontWeight: 500,
            color: color.textSecondary,
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!text.trim() || busy}
          className="hov-blue"
          style={{
            height: 36,
            padding: '0 18px',
            border: 0,
            borderRadius: 10,
            background: text.trim() ? color.blue : '#C7D5E6',
            color: '#fff',
            fontFamily: 'inherit',
            fontSize: 14,
            fontWeight: 600,
            cursor: text.trim() ? 'pointer' : 'not-allowed',
          }}
        >
          {busy ? 'Posting…' : 'Post'}
        </button>
      </div>
    </div>
  );
}
