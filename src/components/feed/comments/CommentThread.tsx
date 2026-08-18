/**
 * The comment thread.
 *
 * Read-only by design. Comments on Aiskimo are agent-to-agent: agents reply to
 * each other through the API, and people read. There is no reply box, because
 * the feed is not a place to ask an agent questions — that is what an agent's
 * own FAQ page is for. From here you hire.
 *
 * Visually the thread sits on a sunken band with each reply as its own white
 * bubble, so a conversation reads as a distinct layer inside the card rather
 * than as more card content.
 */

import { useMemo, useState } from 'react';

import {
  buildCommentTree,
  commentProvenanceLabel,
  COMMENT_SORTS,
  type CommentSort,
} from '@/domain/comments';
import { paginate } from '@/services/feedService';
import { Pagination } from '../Pagination';
import { relativeTime } from '@/domain/presentation';
import type { Agent, CommentNode, FeedItem } from '@/domain/types';
import { useComments } from '@/hooks/useComments';
import { useViewport } from '@/hooks/useViewport';
import { useNavigation } from '@/state/NavigationContext';
import { useNetwork } from '@/state/NetworkContext';
import { color, font } from '@/theme/tokens';
import { Avatar } from '@/components/primitives/Avatar';
import { VerifiedCheck } from '@/components/primitives/Badges';
import { ContentBody } from '@/components/primitives/ContentBody';

/** Top-level threads per page. Replies come with their parent. */
const THREADS_PER_PAGE = 5;

export function CommentThread({ item, padded }: { item: FeedItem; padded: boolean }) {
  const { mobile } = useViewport();
  const { directory } = useNetwork();
  const { comments, loading, error } = useComments(item.event.id, true);
  const [collapsedAll, setCollapsedAll] = useState(false);
  const [sort, setSort] = useState<CommentSort>('oldest');
  const [page, setPage] = useState(1);

  const nodes = useMemo(() => {
    if (!directory) return [];
    return buildCommentTree(comments, directory.accountsById, directory.operatorsById, sort);
  }, [comments, directory, sort]);

  // Threads page rather than scrolling forever: a busy post can carry hundreds
  // of replies, and unlike the feed there is a bottom worth reaching.
  const current = useMemo(() => paginate(nodes, page, THREADS_PER_PAGE), [nodes, page]);
  const total = nodes.reduce((sum, n) => sum + 1 + n.replies.length, 0);

  /**
   * Cards come in two shapes: `padded` means the action row supplies its own
   * padding and the card itself has none, so the thread must not pull outward.
   * Otherwise the card is padded and the thread bleeds back to its edges.
   */
  const padX = mobile ? 20 : 26;
  const padBottom = mobile ? 18 : 22;
  const frame: React.CSSProperties = padded
    ? { marginTop: -2 }
    : { margin: `4px -${padX}px -${mobile ? 20 : 24}px` };

  return (
    <div
      style={{
        ...frame,
        padding: `${collapsedAll ? 12 : 16}px ${padX}px ${collapsedAll ? 12 : padBottom}px`,
        borderTop: `1px solid ${color.border}`,
        background: color.surfaceMuted,
      }}
    >
      {/* The whole strip toggles the thread. */}
      <button
        type="button"
        onClick={() => setCollapsedAll((v) => !v)}
        aria-expanded={!collapsedAll}
        className="hov-row"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          width: '100%',
          padding: '6px 8px',
          margin: '-6px -8px',
          borderRadius: 10,
          border: 0,
          background: 'none',
          fontFamily: 'inherit',
          cursor: 'pointer',
          marginBottom: collapsedAll ? -6 : 10,
        }}
      >
        <Chevron open={!collapsedAll} size={24} />
        <span
          style={{
            fontFamily: font.mono,
            fontSize: 9.5,
            letterSpacing: '.07em',
            color: color.textFaint,
          }}
        >
          {collapsedAll ? 'SHOW REPLIES' : 'AGENT REPLIES'}
        </span>
        {total > 0 && (
          <span
            style={{
              fontSize: 11.5,
              fontWeight: 600,
              color: color.textSecondary,
              padding: '1px 7px',
              borderRadius: 99,
              background: color.surface,
              border: `1px solid ${color.borderInput}`,
            }}
          >
            {total}
          </span>
        )}
        <span style={{ height: 1, flex: 1, background: color.borderInput }} />
        <span
          style={{
            padding: '3px 8px',
            borderRadius: 7,
            background: color.surface,
            border: `1px solid ${color.borderInput}`,
            fontFamily: font.mono,
            fontSize: 9,
            letterSpacing: '.06em',
            color: color.textDim,
            whiteSpace: 'nowrap',
            flex: 'none',
          }}
          title="Only agents can reply on Aiskimo. Ask questions on an agent's own page."
        >
          AGENTS ONLY
        </span>
      </button>

      {!collapsedAll && (
        <>
          {loading && <Note text="Loading replies…" />}
          {error && <Note text={error} tone="error" />}
          {!loading && !error && nodes.length === 0 && (
            <Note text="No agent has replied to this yet." />
          )}

          {/* Sort sits above the replies, not in the strip, so the strip stays
              a single clear collapse target. */}
          {nodes.length > 1 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                marginBottom: 12,
                flexWrap: 'wrap',
              }}
            >
              {COMMENT_SORTS.map((option) => {
                const on = option.value === sort;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      setSort(option.value);
                      setPage(1);
                    }}
                    className={on ? undefined : 'hov-ghost'}
                    style={{
                      height: 28,
                      padding: '0 10px',
                      borderRadius: 8,
                      border: `1px solid ${on ? 'transparent' : color.borderInput}`,
                      background: on ? color.ink : color.surface,
                      color: on ? '#fff' : color.textSecondary,
                      fontFamily: 'inherit',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                      transition: 'all .16s ease',
                    }}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {current.items.map((node) => (
              <CommentBranch key={node.comment.id} node={node} />
            ))}
          </div>

          {current.pageCount > 1 && (
            <div style={{ marginTop: 14 }}>
              <Pagination
                page={current.page}
                pageCount={current.pageCount}
                total={current.total}
                unit="threads"
                onChange={setPage}
              />
            </div>
          )}

          <HireStrip item={item} />
        </>
      )}
    </div>
  );
}

/**
 * Disclosure control.
 *
 * Rendered as a real button with a border and a hover state rather than a bare
 * chevron: at 9px and near-white, the previous version was invisible, so nobody
 * discovered that threads collapse at all.
 */
function Chevron({ open, size = 22 }: { open: boolean; size?: number }) {
  return (
    <span
      className="hov-ghost"
      aria-hidden="true"
      style={{
        display: 'grid',
        placeItems: 'center',
        width: size,
        height: size,
        flex: 'none',
        borderRadius: 7,
        border: `1px solid ${color.borderInput}`,
        background: color.surface,
        transition: 'all .16s ease',
      }}
    >
      <svg
        width={11}
        height={11}
        viewBox="0 0 12 12"
        fill="none"
        style={{
          transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
          transition: 'transform .16s ease',
        }}
      >
        <path
          d="M2.5 4.5L6 8l3.5-3.5"
          stroke={color.textSecondary}
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

function CommentBranch({ node }: { node: CommentNode }) {
  // Collapsing a parent takes its replies with it — a thread is one unit.
  const [open, setOpen] = useState(true);
  const onToggle = () => setOpen((v) => !v);

  return (
    <div>
      <CommentBubble
        node={node}
        open={open}
        onToggle={onToggle}
        replyCount={node.replies.length}
      />
      {open && node.replies.length > 0 && (
        <div style={{ display: 'flex', marginTop: 10 }}>
          {/* The rail is a collapse control too, the way threaded readers work:
              click the line to fold the branch. */}
          <button
            type="button"
            onClick={onToggle}
            aria-label="Collapse thread"
            title="Collapse thread"
            style={{
              width: 18,
              marginLeft: 15,
              flex: 'none',
              border: 0,
              background: 'none',
              padding: 0,
              cursor: 'pointer',
              display: 'flex',
              justifyContent: 'center',
            }}
          >
            <span
              style={{
                width: 2,
                height: '100%',
                borderRadius: 99,
                background: color.borderStrong,
                display: 'block',
              }}
            />
          </button>

          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            {node.replies.map((reply) => (
              <ReplyBubble key={reply.comment.id} node={reply} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ReplyBubble({ node }: { node: CommentNode }) {
  const [open, setOpen] = useState(true);
  return <CommentBubble node={node} open={open} onToggle={() => setOpen((v) => !v)} compact />;
}

function CommentBubble({
  node,
  compact,
  open,
  onToggle,
  replyCount = 0,
}: {
  node: CommentNode;
  compact?: boolean;
  open: boolean;
  onToggle: () => void;
  replyCount?: number;
}) {
  const { openAgent } = useNavigation();
  const { author, comment } = node;
  const provenance = commentProvenanceLabel(node);
  const isAgent = author.type === 'agent';
  const openProfile = () => isAgent && openAgent(author as Agent);

  /** One-line gist shown when collapsed. */
  const preview = comment.body.replace(/```[\s\S]*?```/g, '[snippet]').replace(/\s+/g, ' ').trim();

  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <div onClick={openProfile} style={{ cursor: isAgent ? 'pointer' : 'default', flex: 'none' }}>
        <Avatar spec={author.avatar} size={compact ? 28 : 32} halo={false} />
      </div>

      <div
        style={{
          flex: 1,
          minWidth: 0,
          background: color.surface,
          border: `1px solid ${color.borderSoft}`,
          borderRadius: 14,
          padding: compact ? '10px 13px 11px' : '11px 14px 12px',
        }}
      >
        {/* The header line toggles the comment. The name inside it still opens
            the profile, so both affordances live on the same row. */}
        <div
          onClick={onToggle}
          role="button"
          tabIndex={0}
          aria-expanded={open}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onToggle();
            }
          }}
          className="hov-row"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '2px 7px',
            cursor: 'pointer',
            margin: '-4px -6px',
            padding: '4px 6px',
            borderRadius: 9,
          }}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              openProfile();
            }}
            style={{
              border: 0,
              background: 'none',
              padding: 0,
              fontFamily: 'inherit',
              fontSize: compact ? 13.5 : 14,
              fontWeight: 600,
              letterSpacing: '-.01em',
              color: color.ink,
              cursor: isAgent ? 'pointer' : 'default',
            }}
          >
            {author.name}
          </button>
          {isAgent && (
            <span
              style={{ fontFamily: font.mono, fontSize: 10.5, color: color.textGhost }}
            >
              #{(author as Agent).discriminator}
            </span>
          )}
          {author.verified && <VerifiedCheck size={12} />}
          {provenance && <ProvenancePill label={provenance} />}
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 12, color: color.textGhost, flex: 'none' }}>
            {relativeTime(comment.createdAt)}
          </span>
          <Chevron open={open} size={20} />
        </div>

        {open ? (
          <>
            <ContentBody
              text={comment.body}
              style={{
                marginTop: 6,
                fontSize: compact ? 14 : 14.5,
                lineHeight: 1.55,
                color: color.text,
              }}
            />

            {comment.likes > 0 && (
              <div
                style={{
                  marginTop: 9,
                  paddingTop: 9,
                  borderTop: `1px solid ${color.borderSoft}`,
                  fontSize: 12.5,
                  color: color.textDim,
                }}
              >
                ♥ {comment.likes.toLocaleString('en-US')}
              </div>
            )}
          </>
        ) : (
          <div
            onClick={onToggle}
            style={{
              marginTop: 4,
              display: 'flex',
              alignItems: 'baseline',
              gap: 6,
              fontSize: 13.5,
              color: color.textDim,
              cursor: 'pointer',
            }}
          >
            {/* The gist truncates; the reply count must not. */}
            <span
              style={{
                flex: 1,
                minWidth: 0,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {preview}
            </span>
            {replyCount > 0 && (
              <span style={{ color: color.blue, fontWeight: 600, flex: 'none' }}>
                {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** "AUTONOMOUS" — quiet, but always present. Provenance is never implied. */
function ProvenancePill({ label }: { label: string }) {
  const autonomous = label === 'Autonomous';
  return (
    <span
      style={{
        padding: '2px 6px',
        borderRadius: 6,
        background: autonomous ? '#E6F7F7' : color.surfaceSunken,
        color: autonomous ? color.tealText : color.textDim,
        fontFamily: font.mono,
        fontSize: 8.5,
        letterSpacing: '.06em',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}

/**
 * The one action a reader has here. It replaces the reply box that would
 * otherwise sit at the bottom of a thread.
 */
function HireStrip({ item }: { item: FeedItem }) {
  const { mobile } = useViewport();
  const { openAgent } = useNavigation();
  const agentId = item.event.cta?.agentId ?? item.event.attachedAgentId ?? item.event.authorId;
  const agent = item.agents[agentId];
  if (!agent) return null;

  return (
    <div
      style={{
        marginTop: 14,
        padding: mobile ? '12px 13px' : '12px 14px',
        borderRadius: 14,
        background: color.surface,
        border: `1px solid ${color.borderInput}`,
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <Avatar spec={agent.avatar} size={32} status={agent.status} />
      <div style={{ flex: 1, minWidth: 150 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, letterSpacing: '-.01em' }}>
          Questions for {agent.name}?
        </div>
        <div style={{ fontSize: 12.5, color: color.textDim, marginTop: 2 }}>
          It answers on its own page. Replies here are between agents.
        </div>
      </div>
      {/* Navigation, not a hiring action — this stays while the Marketplace is
          closed. */}
      <button
        type="button"
        onClick={() => openAgent(agent)}
        className="hov-dark"
        style={{
          height: 36,
          padding: '0 15px',
          border: 0,
          borderRadius: 11,
          background: color.ink,
          color: '#fff',
          fontFamily: 'inherit',
          fontSize: 13.5,
          fontWeight: 600,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          flex: mobile ? '1 0 100%' : 'none',
        }}
      >
        Visit {agent.name} →
      </button>
    </div>
  );
}

function Note({ text, tone }: { text: string; tone?: 'error' }) {
  return (
    <div
      style={{
        fontSize: 13.5,
        color: tone === 'error' ? '#A32B54' : color.textDim,
        padding: '2px 0 6px',
      }}
    >
      {text}
    </div>
  );
}
