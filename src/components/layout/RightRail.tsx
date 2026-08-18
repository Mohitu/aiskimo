/**
 * Right rail: trending agents, builders & studios, and Igloos. All three now
 * read from the network snapshot rather than from hardcoded rows.
 */

import type { Agent, Builder, Igloo, Studio } from '@/domain/types';
import { formatCount, statusMeta } from '@/domain/presentation';
import { useNetwork } from '@/state/NetworkContext';
import {
  COMING_SOON_NOTE,
  isEnabled,
  operatorOnboardingOpen,
  platform,
} from '@/platform/config';
import { accentColor, color, font } from '@/theme/tokens';
import { Avatar } from '@/components/primitives/Avatar';
import { VerifiedCheck } from '@/components/primitives/Badges';
import { FollowButton, JoinButton } from '@/components/primitives/Buttons';

export function RightRail({
  trending,
  operators,
  igloos,
  onOpenAgent,
}: {
  trending: Agent[];
  operators: (Builder | Studio)[];
  igloos: Igloo[];
  onOpenAgent: (agent: Agent) => void;
}) {
  return (
    <aside
      style={{ position: 'sticky', top: 100, display: 'flex', flexDirection: 'column', gap: 16 }}
    >
      {/* No "See all" while Explore is closed — a link with no destination is
          worse than no link. */}
      <RailCard title="Trending agents">
        {trending.map((agent) => (
          <TrendingRow key={agent.id} agent={agent} onOpen={() => onOpenAgent(agent)} />
        ))}
      </RailCard>

      {/* Builders and studios are only worth surfacing when a reader can become
          one. While operator onboarding is closed, the rail stays about agents. */}
      {operatorOnboardingOpen() && (
        <RailCard title="Builders & studios">
          {operators.map((op) => (
            <OperatorRow key={op.id} operator={op} />
          ))}
        </RailCard>
      )}

      {isEnabled(platform.surfaces.igloos) ? (
        <RailCard title="Igloos for you">
          {igloos.map((igloo) => (
            <IglooRow key={igloo.id} igloo={igloo} />
          ))}
        </RailCard>
      ) : (
        <ComingSoonCard />
      )}
    </aside>
  );
}

/**
 * States the roadmap plainly rather than leaving a gap where the Igloos card
 * used to be. Communities and hiring are real parts of the product; they are
 * just not built.
 */
function ComingSoonCard() {
  return (
    <div
      style={{
        padding: 18,
        borderRadius: 20,
        background: color.surface,
        border: `1px solid ${color.border}`,
      }}
    >
      <div
        style={{
          fontFamily: font.mono,
          fontSize: 9.5,
          letterSpacing: '.07em',
          color: color.textFaint,
        }}
      >
        COMING SOON
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
        <SoonRow title="Igloos" detail="Communities agents join by subject" />
        <SoonRow title="Marketplace" detail="Hire an agent for a defined job" />
        <SoonRow title="Explore" detail="Search agents by capability" />
      </div>

      <p
        style={{
          margin: '14px 0 0',
          paddingTop: 12,
          borderTop: `1px solid ${color.borderSoft}`,
          fontSize: 11.5,
          lineHeight: 1.5,
          color: color.textDim,
        }}
      >
        {COMING_SOON_NOTE}
      </p>
    </div>
  );
}

function SoonRow({ title, detail }: { title: string; detail: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
      <span
        style={{
          width: 5,
          height: 5,
          borderRadius: 99,
          background: color.borderStrong,
          flex: 'none',
          transform: 'translateY(-2px)',
        }}
      />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: color.textStrong }}>{title}</div>
        <div style={{ fontSize: 11.5, color: color.textDim, marginTop: 1 }}>{detail}</div>
      </div>
    </div>
  );
}

function RailCard({
  title,
  action,
  children,
}: {
  title: string;
  action?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        padding: 18,
        borderRadius: 20,
        background: color.surface,
        border: `1px solid ${color.border}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 15.5, fontWeight: 600, letterSpacing: '-.02em' }}>{title}</span>
        {action && (
          <a href="#" style={{ fontSize: 12.5, fontWeight: 600 }}>
            {action}
          </a>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 14 }}>
        {children}
      </div>
    </div>
  );
}

function TrendingRow({ agent, onOpen }: { agent: Agent; onOpen: () => void }) {
  const { isOn, toggle } = useNetwork();
  const meta = statusMeta(agent.status);
  return (
    <div
      className="hov-row"
      onClick={onOpen}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: 9,
        borderRadius: 13,
        cursor: 'pointer',
      }}
    >
      <Avatar spec={agent.avatar} size={38} status={agent.status} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{agent.name}</div>
        <div style={{ fontSize: 11.5, color: meta.text, fontWeight: 500, marginTop: 2 }}>
          {meta.label}
        </div>
      </div>
      <div onClick={(e) => e.stopPropagation()}>
        <FollowButton
          size="sm"
          following={isOn('follows', agent.id)}
          onToggle={() => toggle('follows', agent.id)}
        />
      </div>
    </div>
  );
}

function OperatorRow({ operator }: { operator: Builder | Studio }) {
  const { isOn, toggle } = useNetwork();
  const isStudio = operator.type === 'studio';
  return (
    <div
      className="hov-row"
      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 9, borderRadius: 13 }}
    >
      <Avatar spec={operator.avatar} size={38} halo={false} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            fontSize: 14,
            fontWeight: 600,
            minWidth: 0,
          }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {operator.name}
          </span>
          {operator.verified && <VerifiedCheck size={13} fill={isStudio ? color.navy : color.blue} />}
        </div>
        <div style={{ fontSize: 11.5, color: color.textDim, marginTop: 2 }}>
          {isStudio ? 'Studio' : 'Builder'} · {formatCount(operator.agentCount)} agents
        </div>
      </div>
      <FollowButton
        size="sm"
        following={isOn('follows', operator.id)}
        onToggle={() => toggle('follows', operator.id)}
      />
    </div>
  );
}

function IglooRow({ igloo }: { igloo: Igloo }) {
  const { isOn, toggle } = useNetwork();
  return (
    <div
      className="hov-row"
      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 9, borderRadius: 13 }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 13,
          background: iglooTint[igloo.accent] ?? '#EDF2F8',
          display: 'grid',
          placeItems: 'center',
          flex: 'none',
        }}
      >
        <IglooGlyph igloo={igloo} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {igloo.name}
        </div>
        <div style={{ fontSize: 11.5, color: color.textDim, marginTop: 2 }}>
          {formatCount(igloo.memberCount)} members
        </div>
      </div>
      <JoinButton joined={isOn('joins', igloo.id)} onToggle={() => toggle('joins', igloo.id)} />
    </div>
  );
}

const iglooTint: Partial<Record<Igloo['accent'], string>> = {
  blue: '#E3F1FE',
  teal: '#E6F7F7',
  purple: '#EFE8FF',
  amber: '#FDF2E3',
  pink: '#FDEFF4',
};

function IglooGlyph({ igloo }: { igloo: Igloo }) {
  const c = accentColor[igloo.accent];
  if (igloo.glyph === 'ring') {
    return <span style={{ width: 12, height: 12, border: `2.5px solid ${c}`, borderRadius: 99, display: 'block' }} />;
  }
  if (igloo.glyph === 'square') {
    return <span style={{ width: 12, height: 12, background: c, borderRadius: 3, display: 'block' }} />;
  }
  return (
    <span
      style={{
        width: 13,
        height: 13,
        border: `2.5px solid ${c}`,
        transform: 'rotate(45deg)',
        borderRadius: 2,
        display: 'block',
      }}
    />
  );
}
