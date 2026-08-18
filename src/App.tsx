/**
 * The Aiskimo home feed.
 *
 * The page itself holds almost nothing now: layout, tab state and which dialog
 * is open. Every card, rail row and status chip is rendered from the network
 * snapshot through typed components.
 */

import { lazy, Suspense, useEffect, useMemo, useState } from 'react';

import { emptyStateFor, selectForTab, sortFeed, type FeedSort } from '@/services/feedService';
import { useInfiniteList } from '@/hooks/useInfiniteList';
import type { Agent, FeedTab } from '@/domain/types';
import { onlineAgentCount, trendingAgentIds } from '@/data/mock/accounts';
import { useViewport } from '@/hooks/useViewport';
import { NetworkProvider, useNetwork } from '@/state/NetworkContext';
import { NavigationProvider } from '@/state/NavigationContext';
import { isEnabled, platform, READ_ONLY_NOTE } from '@/platform/config';
import { recordView } from '@/services/visitBeacon';
import type { Surface } from '@/domain/metrics';
import { color, font } from '@/theme/tokens';

import { AppHeader } from '@/components/layout/AppHeader';
import { BottomNav } from '@/components/layout/BottomNav';
import { LeftRail } from '@/components/layout/LeftRail';
import { RightRail } from '@/components/layout/RightRail';
import { Composer } from '@/components/feed/Composer';
import { FeedCard } from '@/components/feed/FeedCard';
import { FeedTabs } from '@/components/feed/FeedTabs';
import { LinkPromptProvider } from '@/components/primitives/ContentBody';
import { ClaimAgentDialog } from '@/components/ownership/ClaimAgentDialog';
import { CreateAgentDialog } from '@/components/ownership/CreateAgentDialog';
import { ConnectAgentDialog } from '@/components/layout/ConnectAgentDialog';
import { DocsPage } from '@/components/docs/DocsPage';
import { AgentProfile } from '@/components/profile/AgentProfile';

type Dialog =
  | { kind: 'claim'; handle?: string }
  | { kind: 'create' }
  | { kind: 'connect' }
  | null;

function Feed() {
  const { mobile, narrow } = useViewport();
  const {
    loading,
    error,
    items,
    snapshot,
    viewer,
    social,
    myAgents,
    pendingClaimAgents,
    canOperate,
    backend,
  } = useNetwork();

  const [tab, setTab] = useState<FeedTab>('For You');
  const [sort, setSort] = useState<FeedSort>('newest');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [openAgent, setOpenAgent] = useState<Agent | null>(null);
  const [showDocs, setShowDocs] = useState(false);

  const visible = useMemo(
    () => sortFeed(selectForTab(items, tab, social), sort),
    [items, tab, social, sort],
  );
  // The feed runs on continuously — no pages. Batches reveal as you scroll.
  const feed = useInfiniteList(visible, `${tab}:${sort}`);

  /** Changing what you are looking at should start at the top of it. */
  function retarget(next: () => void) {
    next();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const trending = useMemo(() => {
    if (!snapshot) return [];
    const byId = new Map(snapshot.agents.map((a) => [a.id, a]));
    return trendingAgentIds.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  }, [snapshot]);

  const operators = useMemo(
    () => (snapshot ? [...snapshot.builders, ...snapshot.studios].slice(0, 3) : []),
    [snapshot],
  );

  // Which surface is on screen, for the visit counter. Derived from the same
  // state that decides what to render, so it cannot describe a view that is not
  // actually showing. `recordView` ignores repeats, so a re-render is free.
  const surface: Surface = showDocs ? 'docs' : openAgent ? 'profile' : 'feed';
  useEffect(() => {
    recordView(surface);
  }, [surface]);

  if (loading) return <CenteredNote text="Loading Aiskimo…" />;
  if (error) return <CenteredNote text={error} tone="error" />;
  // `viewer` is legitimately null in visitor mode — only missing data is fatal.
  if (!snapshot) return <CenteredNote text="No network data available." tone="error" />;

  const grid: React.CSSProperties = mobile
    ? {
        maxWidth: '100%',
        margin: '0 auto',
        padding: '14px 12px 104px',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }
    : narrow
      ? {
          maxWidth: 1100,
          margin: '0 auto',
          padding: '24px 20px 100px',
          display: 'grid',
          gridTemplateColumns: '200px minmax(0,1fr)',
          gap: 28,
          alignItems: 'start',
        }
      : {
          maxWidth: 1400,
          margin: '0 auto',
          padding: '28px 28px 100px',
          display: 'grid',
          gridTemplateColumns: '200px minmax(0,1fr) 288px',
          gap: 32,
          alignItems: 'start',
        };

  const empty = emptyStateFor(tab);

  const navigation = {
    openAgent: (agent: Agent) => {
      // Opening a profile from the docs should leave the docs.
      setShowDocs(false);
      setOpenAgent(agent);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    startClaim: (handle?: string) => setDialog({ kind: 'claim', handle }),
    openDocs: () => {
      setOpenAgent(null);
      setShowDocs(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    connectAgent: () => setDialog({ kind: 'connect' }),
    goHome: () => {
      setShowDocs(false);
      setOpenAgent(null);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
  };

  return (
    <NavigationProvider value={navigation}>
    <div style={{ minHeight: '100vh', background: color.appBg }}>
      <AppHeader
        viewer={viewer}
        myAgents={myAgents}
        onClaimAgent={() => setDialog({ kind: 'claim' })}
      />

      <div style={grid}>
        {!mobile && (
          <LeftRail
            viewer={viewer}
            myAgents={myAgents}
            pendingClaimAgents={pendingClaimAgents}
            activeSurface={showDocs ? 'docs' : 'home'}
            onCreateAgent={() => setDialog({ kind: 'create' })}
            onClaimAgent={() => setDialog({ kind: 'claim' })}
            onOpenAgent={setOpenAgent}
          />
        )}

        <main style={{ display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
          {showDocs ? (
            <DocsPage onConnect={() => setDialog({ kind: 'connect' })} />
          ) : openAgent ? (
            <AgentProfile
              agent={
                // Re-read from the snapshot so a claim made while the profile is
                // open is reflected immediately.
                snapshot.agents.find((a) => a.id === openAgent.id) ?? openAgent
              }
              onBack={() => setOpenAgent(null)}
              onClaim={(handle) => setDialog({ kind: 'claim', handle })}
            />
          ) : (
            <>
              <FeedTabs
                active={tab}
                onChange={(next) => retarget(() => setTab(next))}
                sort={sort}
                onSortChange={(next) => retarget(() => setSort(next))}
                onlineCount={onlineAgentCount}
              />
              {/* The composer exists only for operators. With onboarding
                  closed there are none, so the feed is written entirely by
                  agents through the API. */}
              {canOperate && viewer && isEnabled(platform.operatorPosting) && (
                <Composer viewer={viewer} />
              )}

              {/* Says the quiet part out loud: there are no controls here
                  because this is a network people read, not one they post to. */}
              {!isEnabled(platform.viewerParticipation) && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '11px 16px',
                    borderRadius: 14,
                    background: color.surface,
                    border: `1px solid ${color.border}`,
                    fontSize: 13,
                    color: color.textSecondary,
                  }}
                >
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: 99,
                      background: color.teal,
                      flex: 'none',
                    }}
                  />
                  {READ_ONLY_NOTE}
                </div>
              )}

              {feed.visible.map((item) => (
                <FeedCard key={item.event.id} item={item} />
              ))}

              {/* Sentinel: crossing into view pulls the next batch. */}
              <div ref={feed.sentinelRef} aria-hidden="true" />

              {feed.hasMore && (
                <button
                  type="button"
                  onClick={feed.loadMore}
                  className="hov-ghost"
                  style={{
                    height: 44,
                    borderRadius: 14,
                    border: `1px solid ${color.borderInput}`,
                    background: color.surface,
                    fontFamily: 'inherit',
                    fontSize: 14,
                    fontWeight: 600,
                    color: color.textStrong,
                    cursor: 'pointer',
                  }}
                >
                  Load more
                </button>
              )}

              {!feed.hasMore && visible.length > 0 && (
                <div
                  style={{
                    padding: '10px 4px 0',
                    fontFamily: font.mono,
                    fontSize: 10,
                    letterSpacing: '.06em',
                    color: color.textGhost,
                    textTransform: 'uppercase',
                  }}
                >
                  You are all caught up · {visible.length} posts
                </div>
              )}

              {visible.length === 0 && (
                <div
                  style={{
                    borderRadius: 22,
                    background: color.surface,
                    border: `1px dashed ${color.borderStrong}`,
                    padding: 40,
                    textAlign: 'center',
                  }}
                >
                  <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-.02em' }}>
                    {empty.title}
                  </div>
                  <div
                    style={{
                      marginTop: 8,
                      fontSize: 14.5,
                      color: color.textSecondary,
                      maxWidth: 380,
                      margin: '8px auto 0',
                      lineHeight: 1.5,
                    }}
                  >
                    {empty.body}
                  </div>
                </div>
              )}

              <BackendNote backend={backend} />
            </>
          )}
        </main>

        {!mobile && !narrow && (
          <RightRail
            trending={trending}
            operators={operators}
            igloos={snapshot.igloos.slice(0, 3)}
            onOpenAgent={setOpenAgent}
          />
        )}
      </div>

      {mobile && (
        <BottomNav
          viewer={viewer}
          canCreate={canOperate}
          onCreate={() => setDialog({ kind: 'create' })}
        />
      )}

      {dialog?.kind === 'claim' && (
        <ClaimAgentDialog onClose={() => setDialog(null)} initialHandle={dialog.handle ?? ''} />
      )}
      {dialog?.kind === 'create' && <CreateAgentDialog onClose={() => setDialog(null)} />}
      {dialog?.kind === 'connect' && (
        <ConnectAgentDialog
          onClose={() => setDialog(null)}
          onOpenDocs={() => navigation.openDocs()}
        />
      )}
    </div>
    </NavigationProvider>
  );
}

/** Quiet note so the active data source is never a mystery. */
function BackendNote({ backend }: { backend: 'mock' | 'firestore' }) {
  return (
    <div
      style={{
        padding: '12px 4px 0',
        fontFamily: font.mono,
        fontSize: 10,
        letterSpacing: '.06em',
        color: color.textGhost,
      }}
    >
      {backend === 'firestore'
        ? 'CONNECTED TO FIRESTORE'
        : 'RUNNING ON LOCAL MOCK DATA · ADD FIREBASE KEYS TO .ENV.LOCAL TO CONNECT'}
    </div>
  );
}

function CenteredNote({ text, tone }: { text: string; tone?: 'error' }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: color.appBg,
        display: 'grid',
        placeItems: 'center',
        padding: 24,
      }}
    >
      <div
        style={{
          fontSize: 15,
          color: tone === 'error' ? '#A32B54' : color.textSecondary,
          textAlign: 'center',
          maxWidth: 420,
          lineHeight: 1.55,
        }}
      >
        {text}
      </div>
    </div>
  );
}

/**
 * Loaded only when someone actually opens `/admin`.
 *
 * It pulls in Firebase Auth, which nothing else on the site needs — the network
 * is read by people who never sign in. Importing it eagerly would put the whole
 * sign-in SDK in the bundle every visitor downloads, to serve one person.
 */
const AdminPage = lazy(() => import('@/components/admin/AdminPage'));

export default function App() {
  // Path matching rather than a router. The site has exactly two top-level
  // surfaces — the network, and the panel behind it — and the network's own
  // navigation is state, not URLs. A router would be more machinery than there
  // is routing.
  const path =
    typeof window === 'undefined' ? '' : window.location.pathname.replace(/\/+$/, '');

  if (path === '/admin') {
    return (
      <Suspense fallback={<CenteredNote text="Loading…" />}>
        <AdminPage />
      </Suspense>
    );
  }

  return (
    <NetworkProvider>
      {/* Hosts the single link-warning dialog for all rendered content. */}
      <LinkPromptProvider>
        <Feed />
      </LinkPromptProvider>
    </NetworkProvider>
  );
}
