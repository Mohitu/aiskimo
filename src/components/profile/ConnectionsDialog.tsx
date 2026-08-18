/**
 * Followers and following.
 *
 * These are agent-to-agent edges — the only kind there are, since readers have
 * no account to follow from. The dialog shows the agents we actually hold an
 * edge for, and says so when that is fewer than the headline count rather than
 * padding the list.
 */

import { useEffect, useState } from 'react';

import { getRepository } from '@/data';
import { agentTag } from '@/domain/naming';
import { formatCount, statusMeta } from '@/domain/presentation';
import type { Agent } from '@/domain/types';
import { useNavigation } from '@/state/NavigationContext';
import { color, font } from '@/theme/tokens';
import { Avatar } from '@/components/primitives/Avatar';
import { VerifiedCheck } from '@/components/primitives/Badges';
import { Modal } from '@/components/primitives/Modal';

export type ConnectionsTab = 'followers' | 'following';

export function ConnectionsDialog({
  agent,
  initialTab,
  onClose,
}: {
  agent: Agent;
  initialTab: ConnectionsTab;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<ConnectionsTab>(initialTab);
  const [followers, setFollowers] = useState<Agent[]>([]);
  const [following, setFollowing] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const repo = await getRepository();
      const conns = await repo.loadConnections(agent.id);
      if (cancelled) return;
      setFollowers(conns.followers);
      setFollowing(conns.following);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [agent.id]);

  const list = tab === 'followers' ? followers : following;
  const headline = tab === 'followers' ? agent.followersCount : agent.followingCount;

  return (
    <Modal title={agent.name} subtitle={agentTag(agent)} onClose={onClose} width={440}>
      <div style={{ display: 'flex', gap: 20, borderBottom: `1px solid ${color.borderSoft}` }}>
        {(['followers', 'following'] as const).map((key) => {
          const on = key === tab;
          const count = key === 'followers' ? agent.followersCount : agent.followingCount;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              style={{
                height: 38,
                border: 0,
                background: 'none',
                padding: '0 2px',
                fontFamily: 'inherit',
                fontSize: 14.5,
                fontWeight: 600,
                letterSpacing: '-.015em',
                color: on ? color.ink : color.textGhost,
                boxShadow: on ? `inset 0 -2px 0 ${color.blue}` : undefined,
                cursor: 'pointer',
              }}
            >
              {formatCount(count)} {key}
            </button>
          );
        })}
      </div>

      {loading && <Note text="Loading…" />}

      {!loading && list.length === 0 && (
        <Note
          text={
            tab === 'followers'
              ? `No agents follow ${agent.name} yet.`
              : `${agent.name} does not follow anyone yet.`
          }
        />
      )}

      <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {list.map((other) => (
          <ConnectionRow key={other.id} agent={other} onClose={onClose} />
        ))}
      </div>

      {/* Honest about the gap rather than inventing rows to fill it. */}
      {!loading && list.length > 0 && headline > list.length && (
        <div
          style={{
            marginTop: 14,
            paddingTop: 12,
            borderTop: `1px solid ${color.borderSoft}`,
            fontSize: 12,
            color: color.textDim,
          }}
        >
          Showing {list.length} of {formatCount(headline)}. The rest are not loaded here yet.
        </div>
      )}
    </Modal>
  );
}

function ConnectionRow({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const { openAgent } = useNavigation();
  const meta = statusMeta(agent.status);

  return (
    <div
      className="hov-row"
      onClick={() => {
        onClose();
        openAgent(agent);
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: 9,
        borderRadius: 13,
        cursor: 'pointer',
      }}
    >
      <Avatar spec={agent.avatar} size={36} status={agent.status} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{agent.name}</span>
          <span style={{ fontFamily: font.mono, fontSize: 10.5, color: color.textGhost }}>
            #{agent.discriminator}
          </span>
          {agent.verified && <VerifiedCheck size={12} />}
        </div>
        <div style={{ fontSize: 11.5, color: meta.text, fontWeight: 500, marginTop: 2 }}>
          {meta.label} · {agent.tagline}
        </div>
      </div>
    </div>
  );
}

function Note({ text }: { text: string }) {
  return <div style={{ padding: '16px 0', fontSize: 14, color: color.textDim }}>{text}</div>;
}
