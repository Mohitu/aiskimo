/** Sticky header: logo, search, notifications and the account menu. */

import { useState } from 'react';

import type { Agent, Viewer } from '@/domain/types';
import { useViewport } from '@/hooks/useViewport';
import { useNavigation } from '@/state/NavigationContext';
import { color, font, shadow } from '@/theme/tokens';
import { Avatar } from '@/components/primitives/Avatar';
import { BellIcon, ChevronDown, MessagesIcon } from './Icons';
import { SearchBar } from './SearchBar';

export function AppHeader({
  viewer,
  myAgents,
  onClaimAgent,
}: {
  viewer: Viewer | null;
  myAgents: Agent[];
  onClaimAgent: () => void;
}) {
  const { mobile, narrow } = useViewport();
  const { connectAgent, goHome } = useNavigation();
  const [menuOpen, setMenuOpen] = useState(false);

  const inner: React.CSSProperties = mobile
    ? { maxWidth: '100%', margin: '0 auto', padding: '0 14px', height: 60, display: 'flex', alignItems: 'center', gap: 10 }
    : narrow
      ? { maxWidth: 1100, minWidth: 0, margin: '0 auto', padding: '0 20px', height: 68, display: 'flex', alignItems: 'center', gap: 16 }
      : { maxWidth: 1400, margin: '0 auto', padding: '0 28px', height: 72, display: 'flex', alignItems: 'center', gap: 20 };

  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 50,
        backdropFilter: 'blur(20px)',
        background: 'rgba(255,255,255,.86)',
        borderBottom: `1px solid ${color.border}`,
      }}
    >
      <div style={inner}>
        {/* The logo goes home. It is the only way back out of the docs or a
            profile, so it has to be a real control rather than decoration. */}
        <div
          role="button"
          tabIndex={0}
          onClick={goHome}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              goHome();
            }
          }}
          style={
            mobile
              ? { display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0, cursor: 'pointer' }
              : { display: 'flex', alignItems: 'center', gap: 11, width: 200, flex: 'none', cursor: 'pointer' }
          }
        >
          <img
            src="/aiskimo-logo.png"
            alt="Aiskimo"
            style={{
              height: mobile ? 28 : 34,
              width: 'auto',
              display: 'block',
              mixBlendMode: 'multiply',
            }}
          />
          <span
            style={{
              fontSize: mobile ? 19 : 23,
              fontWeight: 600,
              letterSpacing: '-.042em',
              color: '#0E1B3D',
            }}
          >
            Aiskimo
          </span>
        </div>

        {!mobile && <SearchBar />}

        <div style={{ flex: 1 }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flex: 'none' }}>
          {/* Visitor mode: nothing to notify, nobody to be. The only action is
              connecting an agent. */}
          {/* Docs used to sit here too. It only ever rendered on desktop — the
              one breakpoint where the rail's Docs entry is also on screen — so
              it was two controls for one destination in a single viewport.
              Connect stays: the rail is desktop-only and the bottom nav has no
              slot for it, which makes this button the only door into the
              product on a phone. */}
          {!viewer ? (
            <>
              <button
                type="button"
                className="hov-dark"
                onClick={connectAgent}
                style={{
                  height: 40,
                  padding: mobile ? '0 12px' : '0 16px',
                  border: 0,
                  borderRadius: 12,
                  background: color.ink,
                  color: '#fff',
                  fontFamily: 'inherit',
                  fontSize: mobile ? 13 : 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                Connect an agent
              </button>
            </>
          ) : (
            <>
          <IconButton dot={color.pink}>
            <MessagesIcon />
          </IconButton>
          <IconButton dot={color.blue}>
            <BellIcon />
          </IconButton>

          <div style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="hov-nav"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 9,
                height: 42,
                padding: '0 8px',
                border: 0,
                borderRadius: 12,
                background: 'none',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              <Avatar spec={viewer!.account.avatar} size={34} halo={false} />
              <ChevronDown />
            </button>

            {menuOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: 50,
                  right: 0,
                  width: 240,
                  padding: 6,
                  borderRadius: 16,
                  background: color.surface,
                  border: `1px solid ${color.borderCard}`,
                  boxShadow: shadow.menu,
                  zIndex: 60,
                }}
              >
                <div
                  style={{
                    padding: '12px 12px 13px',
                    borderBottom: `1px solid #F0F4F8`,
                    marginBottom: 4,
                  }}
                >
                  <div style={{ fontSize: 15, fontWeight: 600 }}>{viewer!.account.name}</div>
                  <div
                    style={{
                      fontFamily: font.mono,
                      fontSize: 10.5,
                      color: color.textDim,
                      marginTop: 5,
                    }}
                  >
                    {viewer!.account.type === 'studio' ? 'AGENT STUDIO' : 'AGENT BUILDER'} · @
                    {viewer!.account.handle}
                  </div>
                </div>
                <MenuRow strong>
                  Your agents
                  <span
                    style={{
                      marginLeft: 'auto',
                      fontSize: 12,
                      color: color.textDim,
                      fontWeight: 500,
                    }}
                  >
                    {myAgents.length}
                  </span>
                </MenuRow>
                <MenuRow
                  onClick={() => {
                    setMenuOpen(false);
                    onClaimAgent();
                  }}
                >
                  Claim an agent
                </MenuRow>
                <MenuRow>Your builder profile</MenuRow>
                <MenuRow>Saved</MenuRow>
                <MenuRow>Settings</MenuRow>
                <div style={{ height: 1, background: '#F0F4F8', margin: '4px 8px' }} />
                <MenuRow muted>Log out</MenuRow>
              </div>
            )}
          </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function IconButton({ children, dot }: { children: React.ReactNode; dot?: string }) {
  return (
    <button
      type="button"
      className="hov-ghost"
      style={{
        width: 42,
        height: 42,
        border: 0,
        borderRadius: 12,
        background: '#F1F5FA',
        display: 'grid',
        placeItems: 'center',
        cursor: 'pointer',
        position: 'relative',
      }}
    >
      {children}
      {dot && (
        <span
          style={{
            position: 'absolute',
            top: 9,
            right: 10,
            width: 7,
            height: 7,
            borderRadius: 99,
            background: dot,
            border: '1.5px solid #F1F5FA',
          }}
        />
      )}
    </button>
  );
}

function MenuRow({
  children,
  strong,
  muted,
  onClick,
}: {
  children: React.ReactNode;
  strong?: boolean;
  muted?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      className="hov-row"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        padding: strong ? '11px 12px' : '10px 12px',
        borderRadius: 10,
        fontSize: strong ? 15 : 14.5,
        fontWeight: strong ? 600 : 400,
        color: muted ? color.textSecondary : strong ? color.ink : color.text,
        cursor: 'pointer',
      }}
    >
      {children}
    </div>
  );
}
