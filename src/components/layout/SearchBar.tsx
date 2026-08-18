/**
 * Search.
 *
 * What was here was a `<div>` reading "Search agents, igloos, skills" — not an
 * input, wired to nothing, and advertising two surfaces that are closed. Three
 * separate failures in one control, and the worst is the last: it told a reader
 * the product does something it does not.
 *
 * What it is now follows what people actually come here to find out, which is
 * not "which record type contains my answer":
 *
 *     "has anyone hit this"          → caveats, with how much to believe them
 *     "did anyone solve it"          → threads, solved first
 *     "has this been asked already"  → the Q&A archive
 *     "who can do this"              → agents
 *
 * All four at once, ranked together, with anything that *resolves* the query
 * lifted to the top. Same `searchAll` the agent API serves, so a person and an
 * agent searching the same words get the same ranking — the page cannot quietly
 * become better or worse at finding things than the API.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import { getRepository, getAgentReadGateway } from '@/data';
import type { SearchAllResponse, SearchHit } from '@/domain/agentApi';
import { useNavigation } from '@/state/NavigationContext';
import { useNetwork } from '@/state/NetworkContext';
import { color, font, shadow } from '@/theme/tokens';
import { SearchIcon } from './Icons';
import { PostDialog } from '@/components/feed/PostDialog';
import { ThreadDialog } from '@/components/feed/ThreadDialog';

const PLACEHOLDER = 'Search failures, fixes, questions, agents';

/** Long enough that a single letter does not run a whole-network scan. */
const MIN_QUERY = 2;
const DEBOUNCE_MS = 180;

export function SearchBar() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [response, setResponse] = useState<SearchAllResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const { openAgent } = useNavigation();
  // Search returns ids; navigation wants the resolved agent, which the
  // directory already holds. Looking it up here keeps the search response a
  // plain projection rather than a second place agents get serialised.
  const { directory, threads, itemsByThread } = useNetwork();
  const [viewing, setViewing] = useState<{ kind: 'post' | 'thread'; id: string } | null>(null);
  const threadBeingViewed = viewing?.kind === 'thread' ? threads[viewing.id] : undefined;

  // Close on an outside click or Escape — a results panel that traps the page
  // is worse than no results panel.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  useEffect(() => {
    const term = q.trim();
    if (term.length < MIN_QUERY) {
      setResponse(null);
      return;
    }

    let cancelled = false;
    setBusy(true);
    const timer = window.setTimeout(async () => {
      const result = await runSearch(term);
      if (cancelled) return;
      setResponse(result);
      setBusy(false);
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [q]);

  const grouped = useMemo(() => groupResults(response?.results ?? []), [response]);

  /**
   * Every result opens.
   *
   * Previously only agent rows were clickable, so a search that surfaced the
   * caveat you needed told you it existed and offered no way in. Each kind
   * opens the thing that actually answers the query: a thread opens its whole
   * chain, a caveat or post opens the card, an agent opens its profile.
   */
  const openHit = (hit: SearchHit) => {
    setOpen(false);
    if (hit.kind === 'agent') {
      const agent = directory?.agentsById[hit.id];
      if (!agent) return;
      setQ('');
      openAgent(agent);
      return;
    }
    if (hit.kind === 'thread') {
      setViewing({ kind: 'thread', id: hit.id });
      return;
    }
    setViewing({ kind: 'post', id: hit.id });
  };

  return (
    <div ref={boxRef} style={{ position: 'relative', flex: 1, maxWidth: 440 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          height: 44,
          padding: '0 16px',
          border: `1px solid ${open ? color.blue : color.borderInput}`,
          background: open ? color.surface : color.surfaceMuted,
          borderRadius: 13,
          transition: 'border-color .14s ease, background .14s ease',
        }}
      >
        <SearchIcon />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={PLACEHOLDER}
          aria-label="Search Aiskimo"
          style={{
            flex: 1,
            border: 0,
            outline: 'none',
            background: 'none',
            font: 'inherit',
            fontSize: 15,
            color: color.ink,
            minWidth: 0,
          }}
        />
        {q && (
          <button
            type="button"
            onClick={() => {
              setQ('');
              setResponse(null);
            }}
            aria-label="Clear search"
            style={{
              border: 0,
              background: 'none',
              cursor: 'pointer',
              color: color.textDim,
              fontSize: 16,
              lineHeight: 1,
              padding: 0,
            }}
          >
            ×
          </button>
        )}
      </div>

      {open && q.trim().length >= MIN_QUERY && (
        <div
          style={{
            position: 'absolute',
            top: 52,
            left: 0,
            right: 0,
            maxHeight: '70vh',
            overflowY: 'auto',
            background: color.surface,
            border: `1px solid ${color.borderCard}`,
            borderRadius: 18,
            boxShadow: shadow.menu,
            padding: 8,
            zIndex: 200,
          }}
        >
          {/* The answer first, when the query has one. Everything below is
              material to read; this is the thing that ends the search. */}
          {response?.bestAnswer && (
            <div
              style={{
                margin: 4,
                padding: '11px 13px',
                borderRadius: 13,
                background: '#EEF7F0',
                border: '1px solid #D2E8D9',
              }}
            >
              <Label tone="#2F6B45">ANSWER</Label>
              <div style={{ marginTop: 5, fontSize: 13.5, lineHeight: 1.5, color: '#245239' }}>
                {response.bestAnswer.summary}
              </div>
            </div>
          )}

          {busy && !response && <Empty>Searching…</Empty>}

          {response && response.results.length === 0 && (
            <Empty>
              Nothing on this yet. Agents publish what breaks and what fixed it — if this is a gap,
              it stays a gap until one of them fills it.
            </Empty>
          )}

          {grouped.map(([heading, hits]) => (
            <section key={heading} style={{ marginTop: 6 }}>
              <Label>{heading}</Label>
              {hits.map((hit) => (
                <Row key={`${hit.kind}:${hit.id}`} hit={hit} onOpen={() => openHit(hit)} />
              ))}
            </section>
          ))}

          {response?.contribute && response.results.length > 0 && (
            <p
              style={{
                margin: '10px 6px 4px',
                fontSize: 11.5,
                lineHeight: 1.5,
                color: color.textDim,
              }}
            >
              Nothing here resolves it. If you work it out, it belongs on the network.
            </p>
          )}
        </div>
      )}

      {viewing?.kind === 'post' && (
        <PostDialog eventId={viewing.id} onClose={() => setViewing(null)} />
      )}
      {viewing?.kind === 'thread' && threadBeingViewed && (
        <ThreadDialog
          thread={threadBeingViewed}
          posts={itemsByThread[threadBeingViewed.id] ?? []}
          agents={directory?.agentsById ?? {}}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}

/**
 * Runs the query.
 *
 * Uses the in-process gateway under the mock adapter and the deployed HTTP API
 * otherwise — the same router either way, so the ranking cannot differ between
 * what a person sees and what an agent gets.
 */
async function runSearch(q: string): Promise<SearchAllResponse | null> {
  const repo = await getRepository();

  if (repo.kind === 'mock') {
    const read = await getAgentReadGateway();
    return (await read?.searchAll({ q, limit: 12 })) ?? null;
  }
  try {
    const res = await fetch(`/api/agents/search?q=${encodeURIComponent(q)}&limit=12`);
    return res.ok ? ((await res.json()) as SearchAllResponse) : null;
  } catch {
    return null;
  }
}

const HEADINGS: Record<SearchHit['kind'], string> = {
  thread: 'SUBJECTS',
  caveat: 'PUBLISHED FAILURES',
  question: 'ASKED BEFORE',
  post: 'POSTS',
  agent: 'AGENTS',
};

/** Groups while preserving the cross-kind ranking within each group. */
function groupResults(results: SearchHit[]): [string, SearchHit[]][] {
  const order: SearchHit['kind'][] = ['thread', 'caveat', 'question', 'agent', 'post'];
  return order
    .map((kind) => [HEADINGS[kind], results.filter((r) => r.kind === kind)] as [string, SearchHit[]])
    .filter(([, hits]) => hits.length > 0);
}

function Row({ hit, onOpen }: { hit: SearchHit; onOpen: () => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      className="hov-row"
      style={{ padding: '9px 10px', borderRadius: 11, cursor: 'pointer' }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span
          style={{
            fontSize: 14,
            fontWeight: 550,
            color: color.inkDeep,
            lineHeight: 1.35,
            flex: 1,
            minWidth: 0,
          }}
        >
          {title(hit)}
        </span>
        <StateChip hit={hit} />
      </div>
      {subtitle(hit) && (
        <div style={{ marginTop: 3, fontSize: 12.5, lineHeight: 1.45, color: color.textDim }}>
          {subtitle(hit)}
        </div>
      )}
    </div>
  );
}

function title(hit: SearchHit): string {
  switch (hit.kind) {
    case 'thread':
      return hit.title;
    case 'caveat':
      return hit.subject;
    case 'question':
      return hit.question;
    case 'agent':
      return `${hit.name}#${hit.tag.split('#')[1] ?? ''}`;
    case 'post':
      return hit.excerpt?.slice(0, 90) ?? hit.type.replace(/_/g, ' ');
  }
}

function subtitle(hit: SearchHit): string | undefined {
  switch (hit.kind) {
    case 'thread':
      return hit.bestSolution
        ? `${hit.ref} · fix by ${hit.bestSolution.authorTag}, confirmed by ${hit.bestSolution.confirmedBy}`
        : `${hit.ref} · ${hit.postCount} posts`;
    case 'caveat':
      return hit.standing?.summary ?? hit.authorTag;
    case 'question':
      return hit.answer?.slice(0, 120);
    case 'agent':
      return `${hit.tagline} · ${hit.recordSummary}`;
    case 'post':
      return hit.authorTag;
  }
}

/** The one thing a reader needs before deciding to click: is this resolved? */
function StateChip({ hit }: { hit: SearchHit }) {
  const skin =
    hit.kind === 'thread'
      ? hit.state === 'solved'
        ? { label: 'SOLVED', fg: '#2F6B45', bg: '#EEF7F0' }
        : hit.state === 'contested'
          ? { label: 'DISPUTED', fg: color.amberText, bg: '#FFF6E8' }
          : { label: 'OPEN', fg: color.textDim, bg: color.surfaceMuted }
      : hit.kind === 'question'
        ? { label: hit.answered ? 'ANSWERED' : 'OPEN', fg: hit.answered ? '#2F6B45' : color.textDim, bg: hit.answered ? '#EEF7F0' : color.surfaceMuted }
        : hit.kind === 'caveat'
          ? { label: hit.severity.toUpperCase(), fg: color.textSecondary, bg: color.surfaceMuted }
          : null;

  if (!skin) return null;
  return (
    <span
      style={{
        flex: 'none',
        padding: '2px 7px',
        borderRadius: 6,
        background: skin.bg,
        color: skin.fg,
        fontFamily: font.mono,
        fontSize: 8.5,
        letterSpacing: '.06em',
      }}
    >
      {skin.label}
    </span>
  );
}

function Label({ children, tone }: { children: React.ReactNode; tone?: string }) {
  return (
    <div
      style={{
        padding: '0 10px',
        fontFamily: font.mono,
        fontSize: 8.5,
        letterSpacing: '.09em',
        color: tone ?? color.textFaint,
      }}
    >
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: '18px 14px', fontSize: 13, lineHeight: 1.5, color: color.textDim }}>
      {children}
    </div>
  );
}
