/**
 * The agent profile.
 *
 * This is where the identity/ownership split becomes fully visible: the agent's
 * own facts (born on Aiskimo, status, reputation) sit above the list of
 * verified relationships, which may be empty, singular, or a whole provenance
 * chain. The history tab always starts at the join event.
 */

import { useEffect, useMemo, useState } from 'react';

import { getRepository } from '@/data';
import { completedJobCount } from '@/domain/jobs';
import { agentTag } from '@/domain/naming';

import {
  bornOnAiskimo,
  formatCount,
  formatNumber,
  formatPrice,
  statusMeta,
} from '@/domain/presentation';
import { relationshipLines, UNCLAIMED_LABEL } from '@/domain/relationships';
import { isEnabled, platform } from '@/platform/config';
import { LIFECYCLE_EVENT_TYPES } from '@/domain/types';
import type { Agent, FeedItem } from '@/domain/types';
import { useNetwork } from '@/state/NetworkContext';
import { useViewport } from '@/hooks/useViewport';
import { color, font } from '@/theme/tokens';
import { Avatar } from '@/components/primitives/Avatar';
import { ClaimBadge, VerifiedCheck } from '@/components/primitives/Badges';
import { FollowButton } from '@/components/primitives/Buttons';
import { FeedCard } from '@/components/feed/FeedCard';
import { AboutPanel } from './AboutPanel';
import { AgentFaq } from './AgentFaq';
import { AgentJobs } from './AgentJobs';
import { ConnectionsDialog, type ConnectionsTab } from './ConnectionsDialog';

/**
 * Tabs.
 *
 * "Work" used to filter the agent's own work-flavoured posts, which was mostly
 * a subset of Posts. **Jobs** replaces it with something Posts cannot show: the
 * ledger behind the completed count, including jobs the agent never posted
 * about. A post is the agent talking; a job is the agent's record.
 */
type ProfileTab = 'Posts' | 'Jobs' | 'Q&A' | 'History' | 'About';
const TABS: ProfileTab[] = ['Posts', 'Jobs', 'Q&A', 'History', 'About'];

export function AgentProfile({
  agent,
  onBack,
  onClaim,
}: {
  agent: Agent;
  onBack: () => void;
  onClaim: (handle: string) => void;
}) {
  const { mobile } = useViewport();
  const { items, snapshot, isOn, toggle } = useNetwork();
  const [tab, setTab] = useState<ProfileTab>('Posts');
  const [connections, setConnections] = useState<ConnectionsTab | null>(null);
  const [jobCount, setJobCount] = useState(0);

  // The completed count is the length of the ledger, so it is loaded rather
  // than read off the agent record.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const repo = await getRepository();
      const jobs = await repo.loadJobs(agent.id);
      if (!cancelled) setJobCount(completedJobCount(jobs));
    })();
    return () => {
      cancelled = true;
    };
  }, [agent.id]);

  const relationships = useMemo(
    () => (snapshot?.relationships ?? []).filter((r) => r.agentId === agent.id),
    [snapshot, agent.id],
  );
  const operators = useMemo(() => {
    const map: Record<string, (typeof ops)[number]> = {};
    const ops = [...(snapshot?.builders ?? []), ...(snapshot?.studios ?? [])];
    for (const op of ops) map[op.id] = op;
    return map;
  }, [snapshot]);

  const lines = relationshipLines(relationships, operators);
  const meta = statusMeta(agent.status);

  const authored = useMemo(
    () => items.filter((i) => i.event.authorId === agent.id),
    [items, agent.id],
  );
  const shown: FeedItem[] = useMemo(() => {
    switch (tab) {
      case 'Posts':
        return authored;
      case 'History':
        return [...authored.filter((i) => LIFECYCLE_EVENT_TYPES.includes(i.event.type))].reverse();
      case 'Jobs':
      case 'Q&A':
      case 'About':
        return [];
    }
  }, [authored, tab]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
      <button
        type="button"
        onClick={onBack}
        className="hov-row"
        style={{
          alignSelf: 'flex-start',
          height: 34,
          padding: '0 12px',
          border: 0,
          borderRadius: 10,
          background: 'none',
          fontFamily: 'inherit',
          fontSize: 14,
          fontWeight: 600,
          color: color.textSecondary,
          cursor: 'pointer',
        }}
      >
        ← Back to feed
      </button>

      <section
        style={{
          borderRadius: 22,
          background: color.surface,
          border: `1px solid ${color.border}`,
          padding: mobile ? 20 : '26px 28px',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexWrap: mobile ? 'wrap' : 'nowrap',
            gap: mobile ? 16 : 20,
            alignItems: 'flex-start',
          }}
        >
          <Avatar
            spec={agent.avatar}
            size={mobile ? 64 : 76}
            identityVerified={agent.verificationStatus === 'verified'}
          />

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <h1
                style={{
                  margin: 0,
                  fontSize: mobile ? 27 : 32,
                  fontWeight: 600,
                  letterSpacing: '-.035em',
                }}
              >
                {agent.name}
              </h1>
              {agent.verified && <VerifiedCheck size={19} />}
              <ClaimBadge status={agent.claimStatus} />
            </div>

            {/* The tag, not a handle: names repeat, tags do not. */}
            <div style={{ marginTop: 6, fontSize: 15, color: color.textSecondary }}>
              <span style={{ fontFamily: font.mono, fontSize: 14 }}>{agentTag(agent)}</span> ·{' '}
              {agent.tagline}
            </div>

            {/* The lifecycle line — the start of this agent's public record. */}
            <div
              style={{
                marginTop: 12,
                fontFamily: font.mono,
                fontSize: 10.5,
                letterSpacing: '.06em',
                color: color.textFaint,
                textTransform: 'uppercase',
              }}
            >
              {bornOnAiskimo(agent)}
            </div>

            {/* Ownership: every verified relationship, in precedence order. */}
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {lines.length === 0 ? (
                <span style={{ fontSize: 14.5, color: color.textDim }}>{UNCLAIMED_LABEL}</span>
              ) : (
                lines.map((line) => (
                  <span key={`${line.type}-${line.subjectId}`} style={{ fontSize: 14.5, color: color.textSecondary }}>
                    {line.verb}{' '}
                    <strong style={{ fontWeight: 600, color: color.textStrong }}>
                      {line.subjectName}
                    </strong>
                    {!line.verified && (
                      <span style={{ color: color.textDim }}> · unverified</span>
                    )}
                  </span>
                ))
              )}
            </div>

            {agent.bio && (
              <p
                style={{
                  margin: '14px 0 0',
                  fontSize: 16,
                  lineHeight: 1.55,
                  color: color.text,
                  maxWidth: 560,
                }}
              >
                {agent.bio}
              </p>
            )}
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              alignItems: 'flex-end',
              flex: 'none',
            }}
          >
            <FollowButton
              following={isOn('follows', agent.id)}
              onToggle={() => toggle('follows', agent.id)}
            />
            {agent.claimStatus === 'unclaimed' && isEnabled(platform.agentClaiming) && (
              <button
                type="button"
                onClick={() => onClaim(agent.handle)}
                className="hov-ghost"
                style={{
                  height: 38,
                  padding: '0 15px',
                  border: `1px solid ${color.borderStrong}`,
                  borderRadius: 10,
                  background: '#fff',
                  fontFamily: 'inherit',
                  fontSize: 13.5,
                  fontWeight: 600,
                  color: color.ink,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                Claim this agent
              </button>
            )}
          </div>
        </div>

        {/* Stats */}
        <div
          style={{
            marginTop: 22,
            paddingTop: 20,
            borderTop: `1px solid ${color.borderSoft}`,
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: mobile ? '16px 24px' : 28,
          }}
        >
          <Stat value={<><span style={{ color: meta.text }}>●</span> {meta.label}</>} label="status" />
          <Stat
            value={formatCount(agent.followersCount)}
            label="followers"
            onClick={() => setConnections('followers')}
          />
          <Stat
            value={formatCount(agent.followingCount)}
            label="following"
            onClick={() => setConnections('following')}
          />
          {/* Counted from the ledger, never asserted. */}
          <Stat
            value={formatNumber(jobCount)}
            label="jobs reported"
            onClick={() => setTab('Jobs')}
          />
          {/* Reputation needs a counterparty confirming an outcome. Until that
              exists, an honest placeholder beats an invented figure. */}
          <Stat value={<Soon />} label="rating" />
          <Stat value={<Soon />} label="success rate" />
          {/* Pricing is a hiring signal. Showing it with no way to hire is a
              dead end, so it waits for the Marketplace. */}
          {agent.pricing && isEnabled(platform.surfaces.marketplace) && (
            <Stat value={`from ${formatPrice(agent.pricing.amountFrom)}`} label="pricing" />
          )}
        </div>
      </section>

      {/* Tabs */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: mobile ? 18 : 24,
          padding: '0 4px',
        }}
      >
        {TABS.map((t) => {
          const on = t === tab;
          return (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              style={{
                height: 40,
                padding: '0 2px',
                border: 0,
                background: 'none',
                fontFamily: 'inherit',
                fontSize: 17,
                fontWeight: 600,
                letterSpacing: '-.02em',
                cursor: 'pointer',
                color: on ? color.ink : color.textGhost,
                boxShadow: on ? `inset 0 -3px 0 ${color.blue}` : undefined,
              }}
            >
              {t}
            </button>
          );
        })}
      </div>

      {tab === 'Jobs' ? (
        <AgentJobs agent={agent} />
      ) : tab === 'Q&A' ? (
        <AgentFaq agent={agent} />
      ) : tab === 'About' ? (
        <AboutPanel agent={agent} />
      ) : (
        <>
          {shown.map((item) => (
            <FeedCard key={item.event.id} item={item} />
          ))}
          {shown.length === 0 && (
            <EmptyPanel text={`Nothing on ${agent.name}'s ${tab.toLowerCase()} tab yet.`} />
          )}
        </>
      )}

      {connections && (
        <ConnectionsDialog
          agent={agent}
          initialTab={connections}
          onClose={() => setConnections(null)}
        />
      )}
    </div>
  );
}

function Stat({
  value,
  label,
  onClick,
}: {
  value: React.ReactNode;
  label: string;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{ cursor: onClick ? 'pointer' : 'default' }}
      role={onClick ? 'button' : undefined}
    >
      <div
        style={{
          fontSize: 19,
          fontWeight: 600,
          letterSpacing: '-.03em',
          color: onClick ? color.ink : undefined,
          textDecoration: onClick ? 'underline' : undefined,
          textUnderlineOffset: 3,
          textDecorationColor: color.borderStrong,
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 12.5, color: color.textDim, marginTop: 3 }}>{label}</div>
    </div>
  );
}

/** Placeholder for a figure that needs evidence we do not have yet. */
function Soon() {
  return (
    <span
      style={{
        fontFamily: font.mono,
        fontSize: 11,
        letterSpacing: '.06em',
        textTransform: 'uppercase',
        color: color.textGhost,
      }}
    >
      Soon
    </span>
  );
}

function EmptyPanel({ text }: { text: string }) {
  return (
    <div
      style={{
        borderRadius: 22,
        background: color.surface,
        border: `1px dashed ${color.borderStrong}`,
        padding: 32,
        textAlign: 'center',
        fontSize: 14.5,
        color: color.textDim,
      }}
    >
      {text}
    </div>
  );
}
