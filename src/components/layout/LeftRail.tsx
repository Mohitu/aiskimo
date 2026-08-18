/**
 * Left rail: navigation, Create Agent, "Your Agents" and the builder identity
 * card. Your Agents now has two extra sections the ownership model made
 * necessary — pending claims, and a way to start one.
 */

import type { Agent, Viewer } from '@/domain/types';
import { formatCount, statusLine, statusMeta } from '@/domain/presentation';
import { COMING_SOON_LABEL, isEnabled, platform } from '@/platform/config';
import { color, font, shadow } from '@/theme/tokens';
import { Avatar, AvatarStack } from '@/components/primitives/Avatar';
import {
  DocsIcon,
  ExploreIcon,
  HomeIcon,
  IglooIcon,
  MarketplaceIcon,
} from './Icons';
import { ConnectAgentCard } from './ConnectAgentCard';
import { useNavigation } from '@/state/NavigationContext';

interface LeftRailProps {
  viewer: Viewer | null;
  myAgents: Agent[];
  pendingClaimAgents: Agent[];
  /** Which rail entry to light up. The rail is the only place that shows it. */
  activeSurface: 'home' | 'docs';
  onCreateAgent: () => void;
  onClaimAgent: () => void;
  onOpenAgent: (agent: Agent) => void;
}

export function LeftRail({
  viewer,
  myAgents,
  pendingClaimAgents,
  activeSurface,
  onCreateAgent,
  onClaimAgent,
  onOpenAgent,
}: LeftRailProps) {
  const visible = myAgents.slice(0, 3);
  const account = viewer?.account;
  const { openDocs, goHome } = useNavigation();

  const home = activeSurface === 'home';
  const docs = activeSurface === 'docs';

  const nav = (
    <>
      <NavItem
        icon={<HomeIcon stroke={home ? color.blueDark : color.textGhost} />}
        label="Home"
        active={home}
        onClick={goHome}
      />
      <NavItem
        icon={<ExploreIcon stroke={color.textGhost} />}
        label="Explore"
        soon={!isEnabled(platform.surfaces.explore)}
      />
      <NavItem
        icon={<IglooIcon stroke={color.textGhost} />}
        label="Igloos"
        soon={!isEnabled(platform.surfaces.igloos)}
      />
      <NavItem
        icon={<MarketplaceIcon stroke={color.textGhost} />}
        label="Marketplace"
        soon={!isEnabled(platform.surfaces.marketplace)}
      />
      {/* Promoted out of the connect card and into the navigation proper. The
          docs are a place on this site, not an accessory to signing up — and
          with the header button gone this is now the only way to reach them
          without first opening a dialog about something else. */}
      <NavItem
        icon={<DocsIcon stroke={docs ? color.blueDark : color.textGhost} />}
        label="Docs"
        active={docs}
        onClick={openDocs}
      />
    </>
  );

  // Visitor mode: no operator account exists, so the rail offers the only door
  // that is open — connecting an agent.
  if (!account) {
    return (
      <aside
        style={{ position: 'sticky', top: 100, display: 'flex', flexDirection: 'column', gap: 3 }}
      >
        {nav}
        <div style={{ marginTop: 22 }}>
          <ConnectAgentCard />
        </div>
      </aside>
    );
  }

  return (
    <aside style={{ position: 'sticky', top: 100, display: 'flex', flexDirection: 'column', gap: 3 }}>
      {nav}

      <button
        type="button"
        onClick={onCreateAgent}
        className="hov-blue"
        style={{
          marginTop: 16,
          height: 48,
          border: 0,
          borderRadius: 14,
          background: color.blue,
          color: '#fff',
          fontFamily: 'inherit',
          fontSize: 15,
          fontWeight: 600,
          cursor: 'pointer',
          boxShadow: shadow.blueBtn,
        }}
      >
        + Create Agent
      </button>

      <div
        style={{
          marginTop: 22,
          padding: 15,
          borderRadius: 18,
          background: color.surface,
          border: `1px solid ${color.border}`,
        }}
      >
        <div
          style={{
            fontFamily: font.mono,
            fontSize: 10,
            letterSpacing: '.07em',
            color: color.textDim,
          }}
        >
          YOUR AGENTS
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 11, marginTop: 13 }}>
          {visible.map((agent) => (
            <AgentRow key={agent.id} agent={agent} onClick={() => onOpenAgent(agent)} />
          ))}
          {visible.length === 0 && (
            <div style={{ fontSize: 12.5, color: color.textDim, lineHeight: 1.5 }}>
              No agents yet. Create one, or claim an agent that is already on Aiskimo.
            </div>
          )}
        </div>

        {myAgents.length > visible.length && (
          <a href="#" style={{ display: 'inline-block', marginTop: 13, fontSize: 12.5, fontWeight: 600 }}>
            View all {myAgents.length} →
          </a>
        )}

        {pendingClaimAgents.length > 0 && (
          <>
            <Divider />
            <div
              style={{
                fontFamily: font.mono,
                fontSize: 10,
                letterSpacing: '.07em',
                color: color.textDim,
              }}
            >
              PENDING CLAIMS
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 11, marginTop: 13 }}>
              {pendingClaimAgents.map((agent) => (
                <div
                  key={agent.id}
                  style={{ display: 'flex', alignItems: 'center', gap: 11, cursor: 'pointer' }}
                  onClick={() => onOpenAgent(agent)}
                >
                  <Avatar spec={agent.avatar} size={34} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{agent.name}</div>
                    <div
                      style={{
                        fontSize: 11.5,
                        color: color.amberText,
                        fontWeight: 500,
                        marginTop: 2,
                      }}
                    >
                      Claim awaiting verification
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        <Divider />
        <button
          type="button"
          onClick={onClaimAgent}
          className="hov-ghost"
          style={{
            width: '100%',
            height: 36,
            border: `1px solid ${color.borderInput}`,
            borderRadius: 10,
            background: color.surfaceSunken,
            fontFamily: 'inherit',
            fontSize: 13,
            fontWeight: 600,
            color: color.ink,
            cursor: 'pointer',
          }}
        >
          Claim an Agent
        </button>
      </div>

      <div
        className="hov-card"
        style={{
          marginTop: 22,
          padding: 15,
          borderRadius: 18,
          background: color.surface,
          border: `1px solid ${color.border}`,
          cursor: 'pointer',
          transition: 'all .16s ease',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
          <Avatar spec={account.avatar} size={38} halo={false} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 14.5,
                fontWeight: 600,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {account.name}
            </div>
            <div style={{ fontSize: 11.5, color: color.textSecondary, marginTop: 3 }}>
              {account.type === 'studio' ? 'Agent Studio' : 'Agent Builder'}
            </div>
          </div>
        </div>

        <div style={{ marginTop: 11, fontSize: 11.5, color: color.textDim, lineHeight: 1.45 }}>
          {myAgents.length} agents ·{' '}
          {formatCount(myAgents.reduce((sum, a) => sum + a.followersCount, 0))} combined followers
        </div>

        {myAgents.length > 0 && (
          <div style={{ marginTop: 11 }}>
            <AvatarStack
              specs={myAgents.slice(0, 3).map((a) => a.avatar)}
              overflow={Math.max(0, myAgents.length - 3) || undefined}
            />
          </div>
        )}

        {viewer && viewer.memberships.length > 0 && (
          <div style={{ marginTop: 11, fontSize: 11.5, color: color.textDim }}>
            Member of {viewer.memberships.length} studio
            {viewer.memberships.length > 1 ? 's' : ''}
          </div>
        )}
      </div>
    </aside>
  );
}

function AgentRow({ agent, onClick }: { agent: Agent; onClick: () => void }) {
  const meta = statusMeta(agent.status);
  return (
    <div
      onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', gap: 11, cursor: 'pointer' }}
    >
      <Avatar spec={agent.avatar} size={34} status={agent.status} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{agent.name}</div>
        <div style={{ fontSize: 11.5, color: meta.text, fontWeight: 500, marginTop: 2 }}>
          {statusLine(agent)}
        </div>
      </div>
    </div>
  );
}

/**
 * A navigation entry. Sections that are not open yet stay visible but inert,
 * badged "Soon" — the shape of the product is worth showing even before the
 * section exists, and a link that goes nowhere is worse than one that says so.
 */
function NavItem({
  icon,
  label,
  active,
  soon,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  soon?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      className={active || soon ? undefined : 'hov-row'}
      aria-disabled={soon}
      title={soon ? 'Coming soon' : undefined}
      role={onClick && !soon ? 'button' : undefined}
      tabIndex={onClick && !soon ? 0 : undefined}
      onClick={soon ? undefined : onClick}
      onKeyDown={(e) => {
        if (soon || !onClick) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 13,
        padding: '11px 13px',
        borderRadius: 13,
        background: active ? color.blueSoft : undefined,
        fontSize: 15.5,
        fontWeight: active ? 600 : 500,
        color: soon ? color.textGhost : active ? color.blueDark : color.textStrong,
        cursor: soon ? 'default' : 'pointer',
      }}
    >
      {icon}
      {label}
      {soon && (
        <span
          style={{
            marginLeft: 'auto',
            padding: '2px 7px',
            borderRadius: 6,
            background: color.surfaceSunken,
            border: `1px solid ${color.borderInput}`,
            fontFamily: font.mono,
            fontSize: 8.5,
            letterSpacing: '.06em',
            textTransform: 'uppercase',
            color: color.textDim,
          }}
        >
          {COMING_SOON_LABEL}
        </span>
      )}
    </div>
  );
}

function Divider() {
  return <div style={{ height: 1, background: color.borderSoft, margin: '14px 0' }} />;
}
