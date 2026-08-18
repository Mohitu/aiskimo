/**
 * Verified work: completed jobs, delegations between agents, shipped skills and
 * milestones. These are the cards that make reputation legible.
 */

import { useState } from 'react';

import type {
  Agent,
  AgentUpdateEvent,
  CollaborationEvent,
  FeedItem,
  MilestoneEvent,
  WorkCompletedEvent,
} from '@/domain/types';
import { relativeTime } from '@/domain/presentation';
import { useViewport } from '@/hooks/useViewport';
import { accentColor, color, font } from '@/theme/tokens';
import { Avatar, AvatarStack } from '@/components/primitives/Avatar';
import { KindStrip } from '@/components/primitives/Badges';
import { EmphasisHeadline, RichText } from '@/components/primitives/RichText';
import {
  ActionBar,
  AgentCardHeader,
  ArtifactPreview,
  CardShell,
  LeadText,
  OperatorCardHeader,
  RunMeta,
} from '../CardChrome';

// ---------------------------------------------------------------------------
// work_completed
// ---------------------------------------------------------------------------

export function WorkCompletedCard({ item }: { item: FeedItem<WorkCompletedEvent> }) {
  const { mobile } = useViewport();
  const agent = item.agents[item.event.authorId];
  if (!agent) return null;
  const { result, headline } = item.event.payload;

  return (
    <CardShell>
      <KindStrip
        label="AGENT ACTIVITY"
        gradient="linear-gradient(145deg,#8FD3F4,#2F6BE8)"
        style={{ padding: mobile ? '18px 20px 0' : '20px 26px 0' }}
      />
      <AgentCardHeader item={item} agent={agent} />
      <LeadText text={headline} />

      <div
        style={{
          margin: mobile ? '16px 20px 0' : '18px 28px 0',
          padding: mobile ? '16px 18px' : '18px 22px',
          borderRadius: 18,
          background: 'linear-gradient(140deg,#F2F7FE,#EAF6F7)',
          border: `1px solid ${color.borderTint}`,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          {result.metrics.map((metric) => (
            <div key={metric.label}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <span style={{ fontSize: 25, fontWeight: 600, letterSpacing: '-.035em' }}>
                  {metric.value}
                </span>
                <span style={{ fontSize: 14.5, color: color.textStrong }}>{metric.label}</span>
              </div>
              {metric.ratio != null && (
                <div
                  style={{
                    height: 5,
                    borderRadius: 99,
                    background:
                      metric.accent === 'teal' ? 'rgba(18,160,168,.16)' : 'rgba(47,107,232,.14)',
                    marginTop: 7,
                  }}
                >
                  <div
                    style={{
                      width: `${Math.round(metric.ratio * 100)}%`,
                      height: 5,
                      borderRadius: 99,
                      background: metric.accent ? accentColor[metric.accent] : color.blue,
                    }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
        {result.runMeta && <RunMeta text={result.runMeta} />}
      </div>

      <ActionBar item={item} />
    </CardShell>
  );
}

// ---------------------------------------------------------------------------
// collaboration
// ---------------------------------------------------------------------------

export function CollaborationCard({ item }: { item: FeedItem<CollaborationEvent> }) {
  const { mobile } = useViewport();
  const [briefOpen, setBriefOpen] = useState(false);
  const { collaboration } = item.event.payload;
  const initiator = item.agents[collaboration.initiatorAgentId];
  const partner = item.agents[collaboration.partnerAgentId];
  if (!initiator || !partner) return null;

  const sharedOperator = collaboration.sharedOperator
    ? item.operators[collaboration.sharedOperator.id]
    : undefined;

  return (
    <CardShell>
      <div
        style={{
          padding: mobile ? '16px 20px 0' : '20px 26px 0',
          display: 'flex',
          alignItems: 'center',
          gap: mobile ? 10 : 12,
        }}
      >
        <span
          style={{
            fontFamily: font.mono,
            fontSize: 10,
            letterSpacing: '.07em',
            color: color.purple,
          }}
        >
          AGENT COLLABORATION
        </span>
        <span style={{ height: 1, flex: 1, background: color.borderSoft }} />
        <span style={{ fontSize: 13, color: color.textDim, flex: 'none' }}>
          {relativeTime(item.event.createdAt)}
        </span>
      </div>

      <div
        style={
          mobile
            ? {
                padding: '16px 20px 0',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: 16,
              }
            : { padding: '20px 26px 0', display: 'flex', alignItems: 'center', gap: 18 }
        }
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 'none' }}>
          <div style={{ textAlign: 'center' }}>
            <Avatar spec={initiator.avatar} size={54} status={initiator.status} />
            <div style={{ marginTop: 9, fontSize: 13.5, fontWeight: 600 }}>{initiator.name}</div>
            <AgentDiscriminator agent={initiator} />
          </div>

          <button
            type="button"
            onClick={() => setBriefOpen((v) => !v)}
            title={`See what ${initiator.name} asked for`}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 5,
              paddingBottom: 22,
              cursor: 'pointer',
              border: 0,
              background: 'none',
              fontFamily: 'inherit',
            }}
          >
            <span
              style={{
                fontFamily: font.mono,
                fontSize: 9,
                letterSpacing: '.06em',
                color: color.textDim,
                whiteSpace: 'nowrap',
              }}
            >
              DELEGATED BY {initiator.name.toUpperCase()}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                style={{
                  width: 38,
                  height: 2,
                  background: `linear-gradient(90deg,${accentColor[initiator.avatar.accent]},${accentColor[partner.avatar.accent]})`,
                  borderRadius: 99,
                }}
              />
              <span
                style={{
                  width: 0,
                  height: 0,
                  borderLeft: `7px solid ${accentColor[partner.avatar.accent]}`,
                  borderTop: '5px solid transparent',
                  borderBottom: '5px solid transparent',
                  display: 'block',
                }}
              />
            </span>
            <span
              style={{
                fontSize: 11.5,
                fontWeight: 600,
                color: briefOpen ? color.blueDark : color.blue,
                whiteSpace: 'nowrap',
              }}
            >
              {briefOpen ? 'Hide brief' : 'See the brief'}
            </span>
          </button>

          <div style={{ textAlign: 'center' }}>
            <Avatar spec={partner.avatar} size={54} status={partner.status} />
            <div style={{ marginTop: 9, fontSize: 13.5, fontWeight: 600 }}>{partner.name}</div>
            <AgentDiscriminator agent={partner} />
          </div>
        </div>

        <div
          style={
            mobile
              ? { flex: 1, minWidth: 0, width: '100%' }
              : { flex: 1, minWidth: 0, paddingBottom: 22 }
          }
        >
          <p
            style={{
              margin: 0,
              fontSize: 18.5,
              lineHeight: 1.45,
              letterSpacing: '-.012em',
              color: color.inkBody,
            }}
          >
            <RichText text={collaboration.summary} />
          </p>
          {collaboration.resultMeta && (
            <div style={{ marginTop: 10, fontSize: 14, color: color.textSecondary }}>
              {collaboration.resultMeta}
            </div>
          )}
          {sharedOperator && (
            <div style={{ marginTop: 7, fontSize: 13, color: color.textDim }}>
              Both agents operated by{' '}
              <strong style={{ fontWeight: 600, color: color.textStrong }}>
                {sharedOperator.name}
              </strong>
            </div>
          )}
        </div>
      </div>

      {briefOpen && collaboration.brief && (
        <div
          style={{
            margin: mobile ? '14px 20px 0' : '14px 26px 0',
            padding: mobile ? '14px 16px' : '16px 18px',
            borderRadius: 16,
            background: color.surfaceMuted,
            border: `1px solid ${color.borderSoft}`,
          }}
        >
          <div
            style={{
              fontFamily: font.mono,
              fontSize: 9.5,
              letterSpacing: '.06em',
              color: color.textDim,
            }}
          >
            THE BRIEF {initiator.name.toUpperCase()} SENT
          </div>
          <p
            style={{
              margin: '10px 0 0',
              fontSize: 17,
              lineHeight: 1.55,
              color: color.text,
              fontFamily: font.serif,
            }}
          >
            {collaboration.brief}
          </p>
          {collaboration.briefMeta?.length ? (
            <div
              style={{
                marginTop: 12,
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 14,
                fontSize: 12.5,
                color: color.textDim,
              }}
            >
              {collaboration.briefMeta.map((m, i) => (
                <span key={m}>
                  {i > 0 && <span style={{ marginRight: 14 }}>·</span>}
                  {m}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      )}

      {item.event.attachedArtifact && (
        <ArtifactPreview artifact={item.event.attachedArtifact} inset />
      )}
      <ActionBar item={item} />
    </CardShell>
  );
}

// ---------------------------------------------------------------------------
// agent_update — a shipped skill or version
// ---------------------------------------------------------------------------

export function AgentUpdateCard({ item }: { item: FeedItem<AgentUpdateEvent> }) {
  const { mobile } = useViewport();
  const agent = item.agents[item.event.authorId];
  if (!agent) return null;
  const { badge, title, description } = item.event.payload;

  return (
    <CardShell>
      <KindStrip
        label="AGENT UPDATE"
        gradient="linear-gradient(145deg,#D9C4FF,#6B48D8)"
        style={{ padding: mobile ? '18px 20px 0' : '20px 26px 0' }}
      />
      <AgentCardHeader item={item} agent={agent} />
      {item.event.content && (
        <p
          style={{
            margin: mobile ? '16px 20px 0' : '18px 26px 0',
            fontSize: mobile ? 17 : 19,
            lineHeight: 1.5,
            letterSpacing: '-.012em',
            color: color.inkBody,
          }}
        >
          <RichText text={item.event.content} />
        </p>
      )}

      {item.event.attachedArtifact && <ArtifactPreview artifact={item.event.attachedArtifact} />}

      <div style={{ padding: mobile ? '18px 20px 0' : '20px 26px 0' }}>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
            padding: '5px 11px',
            borderRadius: 99,
            background: '#F0EBFF',
            fontFamily: font.mono,
            fontSize: 10,
            letterSpacing: '.07em',
            color: color.purple,
          }}
        >
          {badge}
        </div>
        <h3
          style={{
            margin: '12px 0 0',
            fontSize: mobile ? 23 : 27,
            letterSpacing: '-.035em',
            fontWeight: 600,
          }}
        >
          {title}
        </h3>
        <div
          style={{
            marginTop: 10,
            fontSize: 15,
            lineHeight: 1.55,
            color: color.textMuted,
            maxWidth: 520,
          }}
        >
          {description}
        </div>
      </div>

      <ActionBar item={item} />
    </CardShell>
  );
}

// ---------------------------------------------------------------------------
// milestone — agent trend or studio portfolio
// ---------------------------------------------------------------------------

export function MilestoneCard({ item }: { item: FeedItem<MilestoneEvent> }) {
  const { mobile } = useViewport();
  const p = item.event.payload;
  const isStudio = item.author.type === 'studio';
  const agent = item.agents[item.event.authorId];

  return (
    <CardShell padded>
      <KindStrip
        label={isStudio ? 'STUDIO ACTIVITY' : 'AGENT MILESTONE'}
        gradient={isStudio ? color.navy : 'linear-gradient(145deg,#FFE1A8,#C77A16)'}
        style={{ marginBottom: 16 }}
        right={
          !isStudio ? (
            <span style={{ fontSize: 13, color: color.textDim, flex: 'none' }}>
              {relativeTime(item.event.createdAt)}
            </span>
          ) : undefined
        }
      />

      {isStudio ? (
        <OperatorCardHeader
          item={item}
          phrase=""
          metaLine={`AGENT STUDIO · PORTFOLIO MILESTONE · ${relativeTime(item.event.createdAt).toUpperCase()}`}
          right={<span />}
        />
      ) : (
        agent && (
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            <Avatar spec={agent.avatar} size={52} status={agent.status} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontFamily: font.mono,
                  fontSize: 10,
                  color: color.textGhost,
                  marginBottom: 4,
                }}
              >
                {agent.name}#{agent.discriminator}
              </div>
              <EmphasisHeadline
                template={p.headline}
                emphasis={p.emphasis}
                style={{
                  fontSize: mobile ? 20 : 23,
                  fontWeight: 600,
                  letterSpacing: '-.032em',
                  lineHeight: 1.2,
                  color: color.inkDeep,
                }}
              />
              {p.subline && (
                <div style={{ marginTop: 8, fontSize: 14, color: color.textSecondary }}>
                  {p.subline}
                </div>
              )}
            </div>
          </div>
        )
      )}

      {isStudio && (
        <EmphasisHeadline
          template={p.headline}
          emphasis={p.emphasis}
          style={{
            marginTop: 18,
            fontSize: mobile ? 21 : 25,
            lineHeight: 1.3,
            letterSpacing: '-.03em',
            fontWeight: 500,
            color: color.inkDeep,
            maxWidth: 600,
          }}
        />
      )}

      {p.stats?.length ? (
        <div
          style={{
            marginTop: 18,
            padding: '20px 22px',
            borderRadius: 18,
            background: color.surfaceMuted,
            border: `1px solid ${color.borderSoft}`,
          }}
        >
          <div
            style={{
              display: 'flex',
              flexWrap: mobile ? 'wrap' : 'nowrap',
              alignItems: 'center',
              gap: mobile ? '16px 22px' : 22,
            }}
          >
            {p.stats.map((stat, i) => (
              <div key={stat.label} style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
                {i > 0 && !mobile && (
                  <span style={{ width: 1, height: 34, background: color.border }} />
                )}
                <div>
                  <div style={{ fontSize: 25, fontWeight: 600, letterSpacing: '-.035em' }}>
                    {stat.value}
                  </div>
                  <div style={{ fontSize: 12.5, color: color.textDim, marginTop: 3 }}>
                    {stat.label}
                  </div>
                </div>
              </div>
            ))}
            <div style={{ flex: 1 }} />
            {p.rosterAgentIds?.length ? (
              <AvatarStack
                specs={p.rosterAgentIds.flatMap((id) =>
                  item.agents[id] ? [item.agents[id].avatar] : [],
                )}
                size={38}
                overflow={p.rosterOverflow}
                ringColor={color.surfaceMuted}
              />
            ) : null}
          </div>
        </div>
      ) : null}

      {p.trend?.length ? (
        <div
          style={{
            marginTop: 20,
            padding: '18px 20px',
            borderRadius: 18,
            background: color.surfaceWarm,
            border: `1px solid ${color.borderWarm}`,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 52 }}>
            {p.trend.map((v, i) => (
              <div
                key={i}
                style={{
                  flex: 1,
                  height: `${Math.round(v * 100)}%`,
                  background: trendShade(i, p.trend!.length),
                  borderRadius: 4,
                }}
              />
            ))}
          </div>
          {p.trendLabel && (
            <div
              style={{
                marginTop: 12,
                fontFamily: font.mono,
                fontSize: 10,
                letterSpacing: '.06em',
                color: '#A6906A',
              }}
            >
              {p.trendLabel}
            </div>
          )}
        </div>
      ) : null}

      <ActionBar item={item} padded={false} />
    </CardShell>
  );
}

/**
 * The four digits that disambiguate a name. Shown wherever an agent appears
 * without the full card header, so identity is consistent across every card.
 */
function AgentDiscriminator({ agent }: { agent: Agent }) {
  return (
    <div
      style={{
        marginTop: 2,
        fontFamily: font.mono,
        fontSize: 10,
        color: color.textGhost,
        letterSpacing: '.02em',
      }}
    >
      #{agent.discriminator}
    </div>
  );
}

/** Bars warm up towards the present, as in the prototype. */
function trendShade(index: number, total: number): string {
  const shades = ['#F3E6D2', '#F0DFC6', '#EFD9B6', '#EACFA1', '#E5C288', '#D9A455', '#C77A16'];
  const step = Math.min(shades.length - 1, Math.floor((index / Math.max(1, total - 1)) * shades.length));
  return shades[step];
}
