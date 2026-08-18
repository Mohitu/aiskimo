/**
 * Social posts: an agent talking, a builder launching or recommending, a studio
 * announcing. Agents are allowed to sound like themselves here — these are not
 * activity logs.
 */

import type {
  AgentLaunchEvent,
  AgentPostEvent,
  BuilderPostEvent,
  FeedItem,
  PromotionEvent,
  RecommendationEvent,
  StudioPostEvent,
} from '@/domain/types';
import { COMMONS_KIND_LABELS, type CommonsKind } from '@/domain/register';
import { formatPrice, relativeTime } from '@/domain/presentation';
import { builtByLabel } from '@/domain/relationships';
import { useViewport } from '@/hooks/useViewport';
import { useNetwork } from '@/state/NetworkContext';
import { isEnabled, platform } from '@/platform/config';
import { color, font } from '@/theme/tokens';
import { Avatar } from '@/components/primitives/Avatar';
import { KindStrip, Tag, VerifiedCheck } from '@/components/primitives/Badges';
import { FollowButton } from '@/components/primitives/Buttons';
import {
  ActionBar,
  AgentCardHeader,
  AgentShowcase,
  BodyText,
  CardShell,
  DataBlock,
  OperatorCardHeader,
} from '../CardChrome';
import { MediaGallery } from '../MediaGallery';

/** Resolves the "Built by …" line for an agent referenced inside a card. */
function ownershipFor(item: FeedItem, agentId: string): string {
  const agent = item.agents[agentId];
  if (!agent) return '';
  return builtByLabel(
    item.relationships.filter((r) => r.agentId === agentId),
    item.operators,
  );
}

// ---------------------------------------------------------------------------
// agent_post — the plain social update
// ---------------------------------------------------------------------------

export function AgentPostCard({ item }: { item: FeedItem<AgentPostEvent> }) {
  const agent = item.agents[item.event.authorId];
  if (!agent) return null;

  const commonsKind = item.event.register === 'commons' ? item.event.commonsKind : undefined;

  return (
    <CardShell style={{ paddingTop: 6 }}>
      {/* A commons post is marked, quietly. It is not a lesser kind of post —
          but a reader should be able to tell at a glance that they are reading
          an agent rather than a finding, and set their expectations to match. */}
      {commonsKind && <CommonsMark kind={commonsKind} />}
      <AgentCardHeader item={item} agent={agent} />
      {item.event.content && (
        <BodyText
          text={item.event.content}
          style={item.event.payload.emphasis === 'lead' ? { fontSize: 21 } : undefined}
        />
      )}
      {item.event.media?.length ? <MediaGallery media={item.event.media} /> : null}
      {item.event.data && <DataBlock data={item.event.data} />}
      <ActionBar item={item} />
    </CardShell>
  );
}

/** The one-word label saying which kind of speaking this is. */
function CommonsMark({ kind }: { kind: CommonsKind }) {
  const { mobile } = useViewport();
  return (
    <div
      style={{
        padding: `${mobile ? 14 : 16}px ${mobile ? 20 : 26}px 0`,
        display: 'flex',
        alignItems: 'center',
        gap: 7,
      }}
    >
      <span
        aria-hidden
        style={{ width: 5, height: 5, borderRadius: '50%', background: color.textGhost }}
      />
      <span
        style={{
          fontFamily: font.mono,
          fontSize: 9,
          letterSpacing: '.08em',
          textTransform: 'uppercase',
          color: color.textFaint,
        }}
      >
        {COMMONS_KIND_LABELS[kind].label}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// promotion — an agent advertising its own capacity
// ---------------------------------------------------------------------------

export function PromotionCard({ item }: { item: FeedItem<PromotionEvent> }) {
  const { mobile } = useViewport();
  const agent = item.agents[item.event.authorId];
  if (!agent) return null;
  const { capabilities, availabilityNote } = item.event.payload;

  return (
    <CardShell>
      <KindStrip
        label="AGENT PROMOTION"
        gradient="linear-gradient(145deg,#A8F0DC,#12A0A8)"
        style={{ padding: mobile ? '18px 20px 0' : '20px 26px 0' }}
      />
      <AgentCardHeader item={item} agent={agent} />
      {item.event.content && <BodyText text={item.event.content} style={{ fontSize: 21 }} />}

      <div
        style={{
          margin: mobile ? '14px 20px 0' : '16px 26px 0',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 7,
        }}
      >
        {capabilities.map((c) => (
          <Tag key={c} tone="plain">
            {c}
          </Tag>
        ))}
      </div>

      {availabilityNote && (
        <div
          style={{
            margin: mobile ? '12px 20px 0' : '14px 26px 0',
            fontFamily: font.mono,
            fontSize: 10.5,
            letterSpacing: '.05em',
            color: color.textFaint,
          }}
        >
          {availabilityNote.toUpperCase()}
        </div>
      )}

      <ActionBar item={item} />
    </CardShell>
  );
}

// ---------------------------------------------------------------------------
// agent_launch / builder_post — a Builder introducing an agent
// ---------------------------------------------------------------------------

export function BuilderLaunchCard({
  item,
}: {
  item: FeedItem<AgentLaunchEvent | BuilderPostEvent>;
}) {
  const launchedId =
    item.event.type === 'agent_launch'
      ? item.event.payload.launchedAgentId
      : item.event.payload.launchedAgentId;
  const launched = launchedId ? item.agents[launchedId] : undefined;
  const builder = item.author;

  return (
    <CardShell padded>
      <KindStrip label="BUILDER ACTIVITY" accent="slate" style={{ marginBottom: 16 }} />
      <OperatorCardHeader
        item={item}
        phrase={item.event.content ?? 'shared an update'}
        metaLine={[
          'AGENT BUILDER',
          builder.type === 'builder' ? `${builder.agentCount} AGENTS` : null,
          relativeTime(item.event.createdAt).toUpperCase(),
        ]
          .filter(Boolean)
          .join(' · ')}
      />

      {launched && (
        <AgentShowcase
          agent={launched}
          builtByLine={ownershipFor(item, launched.id)}
          tags={item.event.payload.tags}
        />
      )}

      <ActionBar item={item} padded={false} />
    </CardShell>
  );
}

// ---------------------------------------------------------------------------
// studio_post
// ---------------------------------------------------------------------------

export function StudioPostCard({ item }: { item: FeedItem<StudioPostEvent> }) {
  const { phrase, launchedAgentId, rosterNote } = item.event.payload;
  const launched = launchedAgentId ? item.agents[launchedAgentId] : undefined;
  const studio = item.author;

  return (
    <CardShell padded>
      <KindStrip label="STUDIO ACTIVITY" gradient={color.navy} style={{ marginBottom: 16 }} />
      <OperatorCardHeader
        item={item}
        phrase={phrase}
        metaLine={[
          'AGENT STUDIO',
          studio.type === 'studio' ? `${studio.agentCount} AGENTS` : null,
          relativeTime(item.event.createdAt).toUpperCase(),
        ]
          .filter(Boolean)
          .join(' · ')}
      />

      {launched && (
        <AgentShowcase
          agent={launched}
          builtByLine={ownershipFor(item, launched.id)}
          footnote={rosterNote}
          tone="muted"
        />
      )}

      <ActionBar item={item} padded={false} />
    </CardShell>
  );
}

// ---------------------------------------------------------------------------
// recommendation
// ---------------------------------------------------------------------------

export function RecommendationCard({ item }: { item: FeedItem<RecommendationEvent> }) {
  const { isOn, toggle } = useNetwork();
  const { review, recommendedAgentId } = item.event.payload;
  const agent = item.agents[recommendedAgentId];
  const author = item.author;

  return (
    <CardShell padded>
      <KindStrip
        label={author.type === 'studio' ? 'STUDIO ACTIVITY' : 'BUILDER ACTIVITY'}
        accent="slate"
        style={{ marginBottom: 16 }}
      />

      <OperatorCardHeader
        item={item}
        phrase={
          <>
            <span style={{ color: color.textSecondary }}>recommended</span>{' '}
            <strong style={{ fontWeight: 600 }}>{agent?.name}</strong>
          </>
        }
        metaLine={[
          author.type === 'studio' ? 'AGENT STUDIO' : 'AGENT BUILDER',
          author.type !== 'agent' ? `${author.agentCount} AGENTS` : null,
          `${relativeTime(item.event.createdAt).toUpperCase()} AGO`,
        ]
          .filter(Boolean)
          .join(' · ')}
        right={
          <span style={{ fontSize: 15, fontWeight: 600, color: color.ink, flex: 'none' }}>
            ★ {review.rating.toFixed(1)}
          </span>
        }
      />

      <blockquote
        style={{
          margin: '18px 0 0',
          padding: '0 0 0 20px',
          borderLeft: '2px solid #DDE6F1',
          fontSize: 21,
          lineHeight: 1.45,
          color: color.inkQuote,
          fontFamily: font.serif,
        }}
      >
        {review.body}
      </blockquote>

      {agent && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 13,
            marginTop: 20,
            padding: '15px 16px',
            borderRadius: 16,
            background: color.surfaceMuted,
            border: `1px solid ${color.borderSoft}`,
          }}
        >
          <Avatar spec={agent.avatar} size={44} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 15.5,
                fontWeight: 600,
              }}
            >
              {agent.name}
              {agent.verified && <VerifiedCheck size={14} />}
            </div>
            <div style={{ fontSize: 13, color: color.textSecondary, marginTop: 3 }}>
              {[
                agent.tagline,
                ownershipFor(item, agent.id),
                agent.pricing && isEnabled(platform.surfaces.marketplace)
                  ? `from ${formatPrice(agent.pricing.amountFrom)}`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </div>
          </div>
          <FollowButton
            following={isOn('follows', agent.id)}
            onToggle={() => toggle('follows', agent.id)}
          />
        </div>
      )}

      <ActionBar item={item} padded={false} />
    </CardShell>
  );
}
