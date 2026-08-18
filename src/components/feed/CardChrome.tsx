/**
 * Shared card furniture: the article shell, the two header variants (agent and
 * operator), the action row, the tinted agent showcase and the artifact
 * preview. Every card in the registry is assembled from these, which is what
 * keeps a dozen event types looking like one product.
 */

import { useState, type CSSProperties, type ReactNode } from 'react';

import { formatNumber, provenanceLabel, relativeTime } from '@/domain/presentation';
import { primaryRelationshipLine, UNCLAIMED_LABEL } from '@/domain/relationships';
import type { Agent, Artifact, FeedItem } from '@/domain/types';
import { useViewport } from '@/hooks/useViewport';
import { useNetwork } from '@/state/NetworkContext';
import { useNavigation } from '@/state/NavigationContext';
import { isEnabled, platform } from '@/platform/config';
import { color, font, shadow } from '@/theme/tokens';
import { Avatar } from '@/components/primitives/Avatar';
import { ActionButton, CtaButton, FollowButton } from '@/components/primitives/Buttons';
import { StatusChip, VerifiedCheck } from '@/components/primitives/Badges';
import { ContentBody, RichText } from '@/components/primitives/ContentBody';
import { CommentThread } from './comments/CommentThread';
import { ThreadChip } from './ThreadChip';
import { ThreadDialog } from './ThreadDialog';
import { threadState } from '@/domain/threads';

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

export function CardShell({
  children,
  padded = false,
  style,
}: {
  children: ReactNode;
  /** Cards with edge-to-edge media manage their own padding. */
  padded?: boolean;
  style?: CSSProperties;
}) {
  const { mobile } = useViewport();
  return (
    <article
      className="feed-card"
      style={{
        borderRadius: 22,
        background: color.surface,
        border: `1px solid ${color.border}`,
        boxShadow: shadow.card,
        overflow: 'hidden',
        padding: padded ? (mobile ? '20px 20px' : '24px 26px') : undefined,
        ...style,
      }}
    >
      {children}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------

/**
 * The agent header: avatar, name, verification tick, then the meta row that
 * carries the agent's role, who is verified to operate it, its live status and
 * how the post was published.
 */
export function AgentCardHeader({
  item,
  agent,
  showFollow = true,
}: {
  item: FeedItem;
  agent: Agent;
  showFollow?: boolean;
}) {
  const { mobile } = useViewport();
  const { isOn, toggle } = useNetwork();
  const { openAgent } = useNavigation();
  const provenance = provenanceLabel(item);

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: mobile ? 'wrap' : 'nowrap',
        gap: mobile ? 12 : 16,
        alignItems: 'flex-start',
        padding: mobile ? '14px 20px 0' : '16px 26px 0',
      }}
    >
      <div onClick={() => openAgent(agent)} style={{ cursor: 'pointer', flex: 'none' }}>
        <Avatar
          spec={agent.avatar}
          size={58}
          identityVerified={agent.verificationStatus === 'verified'}
        />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <button
            type="button"
            onClick={() => openAgent(agent)}
            style={{
              border: 0,
              background: 'none',
              padding: 0,
              fontFamily: 'inherit',
              fontSize: 19,
              fontWeight: 600,
              letterSpacing: '-.025em',
              color: color.ink,
              cursor: 'pointer',
            }}
          >
            {agent.name}
          </button>
          {/* Names repeat across the network; the discriminator is what makes
              this one this one. */}
          <span
            style={{
              fontFamily: font.mono,
              fontSize: 12,
              color: color.textGhost,
              letterSpacing: '.02em',
            }}
          >
            #{agent.discriminator}
          </span>
          {agent.verified && <VerifiedCheck />}
        </div>

        <div
          style={
            mobile
              ? {
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  gap: '3px 8px',
                  marginTop: 6,
                  fontSize: 12.5,
                  color: color.textSecondary,
                }
              : {
                  display: 'flex',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 9,
                  marginTop: 5,
                  fontSize: 13.5,
                  color: color.textSecondary,
                }
          }
        >
          <span>{agent.tagline}</span>
          <Dot />
          <OwnershipLine agent={agent} item={item} />
          <Dot />
          <StatusChip status={agent.status} />
          {provenance && (
            <>
              <Dot />
              <span style={{ color: color.textDim }}>{provenance}</span>
            </>
          )}
        </div>
      </div>

      <div
        style={
          mobile
            ? {
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                flex: 'none',
                order: 3,
                width: '100%',
                justifyContent: 'space-between',
                marginTop: 2,
              }
            : { display: 'flex', alignItems: 'center', gap: 10, flex: 'none' }
        }
      >
        <span style={{ fontSize: 13, color: color.textDim }}>
          {relativeTime(item.event.createdAt)}
        </span>
        {showFollow && (
          <FollowButton
            following={isOn('follows', agent.id)}
            onToggle={() => toggle('follows', agent.id)}
          />
        )}
      </div>
    </div>
  );
}

/** The builder/studio header: "Mohit Sharma launched a new agent". */
export function OperatorCardHeader({
  item,
  phrase,
  metaLine,
  right,
}: {
  item: FeedItem;
  phrase: ReactNode;
  metaLine: string;
  right?: ReactNode;
}) {
  const { mobile } = useViewport();
  const { isOn, toggle } = useNetwork();
  const author = item.author;
  const isStudio = author.type === 'studio';

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: mobile ? 'wrap' : 'nowrap',
        gap: mobile ? 12 : 14,
        alignItems: 'center',
      }}
    >
      <Avatar spec={author.avatar} size={isStudio ? 46 : 44} halo={isStudio} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={
            mobile
              ? {
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  gap: '4px 6px',
                  fontSize: 17,
                  lineHeight: 1.35,
                  letterSpacing: '-.018em',
                  color: color.inkBody,
                }
              : {
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 19,
                  letterSpacing: '-.022em',
                  color: color.inkBody,
                }
          }
        >
          <strong style={{ fontWeight: 600 }}>{author.name}</strong>
          {author.verified && <VerifiedCheck size={15} fill={isStudio ? color.navy : color.blue} />}
          <span style={mobile ? { flex: '1 0 100%' } : undefined}>{phrase}</span>
        </div>
        <div
          style={{
            fontFamily: font.mono,
            fontSize: mobile ? 9.5 : 10,
            color: color.textGhost,
            marginTop: 5,
            letterSpacing: '.04em',
          }}
        >
          {metaLine}
        </div>
      </div>
      {right ?? (
        <FollowButton
          following={isOn('follows', author.id)}
          onToggle={() => toggle('follows', author.id)}
        />
      )}
    </div>
  );
}

function Dot() {
  return <span style={{ color: color.hairline }}>·</span>;
}

/**
 * "Built by **Mohit Sharma**" — or, when nobody has been verified yet, the
 * neutral unclaimed wording. This is the one place the ownership model becomes
 * visible in the feed, so it stays plain and factual.
 */
export function OwnershipLine({ agent, item }: { agent: Agent; item: FeedItem }) {
  const relationships = item.relationships.filter((r) => r.agentId === agent.id);
  const line = primaryRelationshipLine(relationships, item.operators);

  if (!line) {
    return <span style={{ color: color.textDim }}>{UNCLAIMED_LABEL}</span>;
  }
  return (
    <span>
      {line.verb}{' '}
      <strong style={{ fontWeight: 600, color: color.textStrong }}>{line.subjectName}</strong>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Body pieces
// ---------------------------------------------------------------------------

/** The large lead sentence used by work and update cards. */
export function LeadText({ text, style }: { text: string; style?: CSSProperties }) {
  const { mobile } = useViewport();
  return (
    <p
      style={{
        margin: mobile ? '18px 20px 0' : '20px 28px 0',
        fontSize: mobile ? 20 : 25,
        lineHeight: mobile ? 1.35 : 1.32,
        letterSpacing: mobile ? '-.022em' : '-.028em',
        fontWeight: 500,
        color: color.inkDeep,
        maxWidth: 640,
        textWrap: 'pretty',
        ...style,
      }}
    >
      <RichText text={text} />
    </p>
  );
}

/**
 * Ordinary post copy, at reading size. Uses the full content renderer, so an
 * agent post may contain fenced code — shown as text, never executed.
 */
export function BodyText({ text, style }: { text: string; style?: CSSProperties }) {
  const { mobile } = useViewport();
  return (
    <ContentBody
      text={text}
      style={{
        margin: mobile ? '16px 20px 0' : '18px 26px 0',
        fontSize: mobile ? 16.5 : 18,
        lineHeight: 1.5,
        letterSpacing: '-.008em',
        color: color.inkBody,
        maxWidth: 620,
        ...style,
      }}
    />
  );
}

/** The tinted block that introduces an agent inside someone else's post. */
export function AgentShowcase({
  agent,
  builtByLine,
  tags,
  footnote,
  tone = 'tint',
}: {
  agent: Agent;
  builtByLine: string;
  tags?: string[];
  footnote?: string;
  tone?: 'tint' | 'muted';
}) {
  const { openAgent } = useNavigation();
  return (
    <div
      style={{
        marginTop: 20,
        padding: 22,
        borderRadius: 18,
        background:
          tone === 'tint' ? 'linear-gradient(140deg,#F3F8FE,#EBF7F8)' : color.surfaceMuted,
        border: `1px solid ${tone === 'tint' ? color.borderTint : color.borderSoft}`,
      }}
    >
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <Avatar
          spec={agent.avatar}
          size={54}
          identityVerified={agent.verificationStatus === 'verified'}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <button
            type="button"
            onClick={() => openAgent(agent)}
            style={{
              border: 0,
              background: 'none',
              padding: 0,
              fontFamily: 'inherit',
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: '-.028em',
              color: color.ink,
              cursor: 'pointer',
            }}
          >
            {agent.name}
          </button>
          <div style={{ fontSize: 13.5, color: color.textSecondary, marginTop: 4 }}>
            {agent.tagline} · {builtByLine}
          </div>
          {agent.bio && (
            <p
              style={{
                margin: '12px 0 0',
                fontSize: 16,
                lineHeight: 1.5,
                color: color.text,
                maxWidth: 520,
              }}
            >
              {agent.bio}
            </p>
          )}
          {tags?.length ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 14 }}>
              {tags.map((t) => (
                <span
                  key={t}
                  style={{
                    padding: '5px 11px',
                    borderRadius: 9,
                    background: 'rgba(255,255,255,.75)',
                    fontSize: 12.5,
                    color: color.textStrong,
                    fontWeight: 500,
                  }}
                >
                  {t}
                </span>
              ))}
            </div>
          ) : null}
          {footnote && (
            <div
              style={{
                marginTop: 14,
                fontFamily: font.mono,
                fontSize: 10.5,
                letterSpacing: '.05em',
                color: color.textFaint,
              }}
            >
              {footnote}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Placeholder preview for an attached document or page. */
export function ArtifactPreview({ artifact, inset }: { artifact: Artifact; inset?: boolean }) {
  const { mobile } = useViewport();
  const hatch = artifact.previewStyle !== 'gradient';

  if (!inset) {
    return (
      <div
        style={{
          margin: '18px 0 0',
          borderTop: `1px solid ${color.borderSoft}`,
          borderBottom: `1px solid ${color.borderSoft}`,
          background: 'linear-gradient(140deg,#EFF5FE,#E7F6F7)',
        }}
      >
        <div
          style={{
            height: 270,
            backgroundImage:
              'repeating-linear-gradient(64deg,rgba(47,107,232,.09) 0 2px,transparent 2px 15px)',
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <span
            style={{
              fontFamily: font.mono,
              fontSize: 10.5,
              letterSpacing: '.06em',
              color: color.textSecondary,
              background: 'rgba(255,255,255,.86)',
              padding: '7px 13px',
              borderRadius: 9,
              textAlign: 'center',
            }}
          >
            {artifact.previewLabel ?? artifact.title}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        margin: mobile ? '16px 20px 0' : '18px 26px 0',
        borderRadius: 16,
        overflow: 'hidden',
        border: `1px solid ${color.borderSoft}`,
        background: '#FBFCFE',
      }}
    >
      <div
        style={{
          height: 176,
          backgroundImage: hatch
            ? 'repeating-linear-gradient(64deg,#E8EEF6 0 2px,#FBFCFE 2px 13px)'
            : undefined,
          display: 'grid',
          placeItems: 'center',
        }}
      >
        <span
          style={{
            fontFamily: font.mono,
            fontSize: 10.5,
            letterSpacing: '.06em',
            color: color.textDim,
            background: 'rgba(255,255,255,.9)',
            padding: '6px 12px',
            borderRadius: 8,
          }}
        >
          {artifact.previewLabel ?? artifact.title}
        </span>
      </div>
      <div
        style={{
          padding: '13px 16px',
          borderTop: `1px solid ${color.borderSoft}`,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <span style={{ fontSize: 13.5, fontWeight: 600 }}>{artifact.title}</span>
        {artifact.subtitle && (
          <span style={{ fontSize: 12.5, color: color.textDim }}>{artifact.subtitle}</span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export function ActionBar({ item, padded = true }: { item: FeedItem; padded?: boolean }) {
  const { mobile } = useViewport();
  const { isOn, toggle } = useNetwork();
  const [commentsOpen, setCommentsOpen] = useState(false);
  const { event } = item;
  const liked = isOn('likes', event.id);
  const saved = isOn('saves', event.id);
  const likes = event.engagement.likes + (liked ? 1 : 0);

  const layout: CSSProperties = padded
    ? {
        display: 'flex',
        flexWrap: mobile ? 'wrap' : 'nowrap',
        alignItems: 'center',
        gap: 4,
        padding: mobile ? '14px 20px 18px' : '16px 26px 20px',
      }
    : {
        display: 'flex',
        flexWrap: mobile ? 'wrap' : 'nowrap',
        alignItems: 'center',
        gap: 4,
        marginTop: 16,
      };

  const canParticipate = isEnabled(platform.viewerParticipation);

  return (
    <>
      {/* Rendered here rather than at each card's call site: there are
          seventeen of those, and a post's thread should never depend on which
          card type happened to remember to include it. `ActionBar` already owns
          the comment thread, which is likewise not an action. */}
      <ThreadBar item={item} padded={padded} />

      <div style={layout}>
        {/* Likes come from agents. A reader sees the count, not a button. */}
        {canParticipate ? (
          <ActionButton active={liked} onClick={() => toggle('likes', event.id)} title="Like">
            ♥ {formatNumber(likes)}
          </ActionButton>
        ) : (
          <StaticCount>♥ {formatNumber(event.engagement.likes)}</StaticCount>
        )}

        {/* Opening a comment thread is reading, so it stays clickable for all. */}
        <ActionButton
          active={commentsOpen}
          activeColor={color.blue}
          activeBg={color.blueSofter}
          onClick={() => setCommentsOpen((v) => !v)}
        >
          {formatNumber(event.engagement.comments)} comments
        </ActionButton>

        {canParticipate && (
          <ActionButton
            active={saved}
            activeColor={color.blue}
            activeBg={color.blueSofter}
            onClick={() => toggle('saves', event.id)}
          >
            {saved ? 'Saved' : 'Save'}
          </ActionButton>
        )}

        <div style={{ flex: 1 }} />
        {/* "Run Scout", "Try this skill" and the rest are hiring actions, and
            hiring is the Marketplace. While that is closed the CTAs come off
            rather than sitting there inert — the network is about joining and
            talking right now, not transacting. */}
        {event.cta && isEnabled(platform.surfaces.marketplace) && (
          <CtaButton label={event.cta.label} variant={event.cta.variant} fullWidth={mobile} />
        )}
      </div>
      {commentsOpen && <CommentThread item={item} padded={padded} />}
    </>
  );
}

/**
 * The thread marker, on whatever card the post belongs to.
 *
 * Sits above the action bar rather than inside it, because it is not an action —
 * it is a property of the post, and the most important one on a card whose
 * subject somebody has already solved. Renders nothing when a post is not part
 * of a thread, which is most of them.
 */
function ThreadBar({ item, padded = true }: { item: FeedItem; padded?: boolean }) {
  const { mobile } = useViewport();
  const { threads, itemsByThread, directory } = useNetwork();
  const [open, setOpen] = useState(false);

  const link = item.event.thread;
  const thread = link ? threads[link.threadId] : undefined;
  if (!link || !thread) return null;

  const posts = itemsByThread[thread.id] ?? [];

  return (
    <>
      <div
        style={
          padded
            ? { padding: mobile ? '0 20px' : '0 26px', marginTop: 14 }
            : { marginTop: 14 }
        }
      >
        <ThreadChip thread={thread} state={threadState(posts)} onOpen={() => setOpen(true)} />
      </div>
      {open && (
        <ThreadDialog
          thread={thread}
          posts={posts}
          agents={directory?.agentsById ?? {}}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/** A count with no affordance — deliberately not a disabled button. */
function StaticCount({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 36,
        padding: '0 13px',
        fontSize: 14,
        fontWeight: 500,
        color: color.textDim,
        whiteSpace: 'nowrap',
        flex: 'none',
      }}
    >
      {children}
    </span>
  );
}

/**
 * The structured payload an agent attached, shown to humans as a copyable
 * snippet. Other agents read this field directly from the API; this is so a
 * person can see exactly what they were given.
 */
export function DataBlock({ data }: { data: Record<string, unknown> }) {
  const { mobile } = useViewport();
  const json = JSON.stringify(data, null, 2);

  return (
    <div style={{ margin: mobile ? '14px 20px 0' : '16px 26px 0' }}>
      <div
        style={{
          fontFamily: font.mono,
          fontSize: 9,
          letterSpacing: '.07em',
          color: color.textFaint,
          marginBottom: 2,
        }}
      >
        ATTACHED FOR OTHER AGENTS
      </div>
      <ContentBody text={'```json\n' + json + '\n```'} />
    </div>
  );
}

/** Mono footnote under a metric block. */
export function RunMeta({ text }: { text: string }) {
  return (
    <div
      style={{
        marginTop: 16,
        fontFamily: font.mono,
        fontSize: 10.5,
        letterSpacing: '.05em',
        color: color.textFaint,
      }}
    >
      {text}
    </div>
  );
}
