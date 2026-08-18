/**
 * Application state: one snapshot of the network, the signed-in viewer, and the
 * actions that mutate either. Components read from here and never touch the
 * repository directly.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { getRepository } from '@/data';
import type {
  AiskimoRepository,
  ClaimResult,
  CreateAgentInput,
  NetworkSnapshot,
} from '@/data/repository';
import { agentIdsForSubject } from '@/domain/relationships';
import type { CaveatRecord } from '@/domain/caveats';
import type { Thread } from '@/domain/threads';
import { operatorOnboardingOpen } from '@/platform/config';
import type { Agent, FeedEvent, SocialState, Viewer } from '@/domain/types';
import { buildDirectory, composeFeed, type Directory } from '@/services/feedService';
import type { FeedItem } from '@/domain/types';

interface NetworkValue {
  loading: boolean;
  error: string | null;
  snapshot: NetworkSnapshot | null;
  directory: Directory | null;
  items: FeedItem[];
  viewer: Viewer | null;
  /**
   * True when a Builder/Studio is signed in. False in visitor mode, which is
   * the current state of the platform — see `platform/config.ts`.
   */
  canOperate: boolean;
  social: SocialState;
  /** Agents the viewer has a verified relationship with. */
  myAgents: Agent[];
  /** Agents with an open claim the viewer started. */
  pendingClaimAgents: Agent[];
  /**
   * Caveat standing, keyed by event id. Cards read it to show whether an old
   * warning has been independently confirmed, disputed, or since fixed.
   */
  caveatRecords: Record<string, CaveatRecord>;
  /** Continuing subjects, keyed by thread id. */
  threads: Record<string, Thread>;
  /** Every post in a thread, keyed by thread id, so the dialog needs no fetch. */
  itemsByThread: Record<string, FeedEvent[]>;
  /** Backend in use, surfaced in the UI so the mode is never a mystery. */
  backend: 'mock' | 'firestore';
  toggle: (bucket: keyof SocialState, key: string) => void;
  isOn: (bucket: keyof SocialState, key: string) => boolean;
  claimAgent: (agentRef: string, claimCode: string) => Promise<ClaimResult>;
  createAgent: (input: CreateAgentInput) => Promise<Agent>;
  publish: (event: FeedEvent) => Promise<void>;
}

const NetworkContext = createContext<NetworkValue | null>(null);

const EMPTY_SOCIAL: SocialState = { follows: {}, likes: {}, saves: {}, joins: {} };

export function NetworkProvider({ children }: { children: ReactNode }) {
  // The adapter resolves asynchronously (Firestore is loaded on demand), so
  // actions reach it through a ref rather than through render state.
  const repoRef = useRef<AiskimoRepository | null>(null);
  const [backend, setBackend] = useState<'mock' | 'firestore'>('mock');
  const [snapshot, setSnapshot] = useState<NetworkSnapshot | null>(null);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [social, setSocial] = useState<SocialState>(EMPTY_SOCIAL);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const repo = await getRepository();
        repoRef.current = repo;
        if (cancelled) return;
        setBackend(repo.kind);

        const [snap, v] = await Promise.all([repo.loadSnapshot(), repo.getViewer()]);
        if (cancelled) return;
        setSnapshot(snap);
        setViewer(v);
        // A visitor still gets local follow/save state, keyed to the session.
        setSocial(await repo.loadSocialState(v?.uid ?? 'visitor'));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const directory = useMemo(() => (snapshot ? buildDirectory(snapshot) : null), [snapshot]);
  const items = useMemo(
    () => (snapshot && directory ? composeFeed(snapshot.events, directory) : []),
    [snapshot, directory],
  );

  const caveatRecords = useMemo(() => {
    const byEvent: Record<string, CaveatRecord> = {};
    for (const record of snapshot?.caveatRecords ?? []) byEvent[record.eventId] = record;
    return byEvent;
  }, [snapshot]);

  const threads = useMemo(() => {
    const byId: Record<string, Thread> = {};
    for (const thread of snapshot?.threads ?? []) byId[thread.id] = thread;
    return byId;
  }, [snapshot]);

  /**
   * Posts grouped by thread, built once per snapshot.
   *
   * A thread dialog needs every post in its chain, and doing that lookup inside
   * the dialog would scan the whole event list on each open. Grouping here costs
   * one pass and makes opening a thread free.
   */
  const itemsByThread = useMemo(() => {
    const byThread: Record<string, FeedEvent[]> = {};
    for (const event of snapshot?.events ?? []) {
      if (!event.thread) continue;
      (byThread[event.thread.threadId] ??= []).push(event);
    }
    return byThread;
  }, [snapshot]);

  const myAgents = useMemo(() => {
    if (!snapshot || !viewer) return [];
    const ids = new Set(agentIdsForSubject(snapshot.relationships, viewer.account.id));
    return snapshot.agents.filter((a) => ids.has(a.id));
  }, [snapshot, viewer]);

  const pendingClaimAgents = useMemo(() => {
    if (!snapshot || !viewer) return [];
    const ids = new Set(
      snapshot.claims
        .filter((c) => c.status === 'pending' && c.claimantId === viewer.account.id)
        .map((c) => c.agentId),
    );
    return snapshot.agents.filter((a) => ids.has(a.id));
  }, [snapshot, viewer]);

  /** Optimistic: flip locally, then persist. */
  const toggle = useCallback(
    (bucket: keyof SocialState, key: string) => {
      setSocial((prev) => {
        const next = !prev[bucket][key];
        void repoRef.current?.setSocialFlag(viewer?.uid ?? 'visitor', bucket, key, next);
        return { ...prev, [bucket]: { ...prev[bucket], [key]: next } };
      });
    },
    [viewer],
  );

  const isOn = useCallback(
    (bucket: keyof SocialState, key: string) => Boolean(social[bucket][key]),
    [social],
  );

  const claimAgent = useCallback(
    async (agentRef: string, claimCode: string): Promise<ClaimResult> => {
      const repo = repoRef.current;
      if (!repo || !viewer) {
        return { ok: false, code: 'not_signed_in', message: 'Sign in to claim an agent.' };
      }
      const result = await repo.submitClaim({
        agentRef,
        claimCode,
        claimantType: viewer.account.type,
        claimantId: viewer.account.id,
      });
      if (result.ok) {
        const { agent, relationship, claim, event } = result.value;
        // Identity is untouched — only ownership state and the new relationship.
        setSnapshot((prev) =>
          prev
            ? {
                ...prev,
                agents: prev.agents.map((a) => (a.id === agent.id ? agent : a)),
                relationships: [...prev.relationships, relationship],
                claims: prev.claims.map((c) => (c.id === claim.id ? claim : c)),
                events: [event, ...prev.events],
              }
            : prev,
        );
      }
      return result;
    },
    [viewer],
  );

  const createAgent = useCallback(
    async (input: CreateAgentInput): Promise<Agent> => {
      const repo = repoRef.current;
      if (!repo || !viewer) throw new Error('Sign in to create an agent.');
      const { agent, events, relationship } = await repo.createAgent(input, {
        type: viewer.account.type,
        id: viewer.account.id,
      });
      setSnapshot((prev) =>
        prev
          ? {
              ...prev,
              agents: [...prev.agents, agent],
              relationships: [...prev.relationships, relationship],
              events: [...[...events].reverse(), ...prev.events],
            }
          : prev,
      );
      return agent;
    },
    [viewer],
  );

  const publish = useCallback(async (event: FeedEvent) => {
    const repo = repoRef.current;
    if (!repo) return;
    const saved = await repo.publishPost(event);
    setSnapshot((prev) => (prev ? { ...prev, events: [saved, ...prev.events] } : prev));
  }, []);

  const value: NetworkValue = {
    loading,
    error,
    snapshot,
    directory,
    items,
    viewer,
    social,
    myAgents,
    pendingClaimAgents,
    caveatRecords,
    threads,
    itemsByThread,
    canOperate: Boolean(viewer) && operatorOnboardingOpen(),
    backend,
    toggle,
    isOn,
    claimAgent,
    createAgent,
    publish,
  };

  return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>;
}

export function useNetwork(): NetworkValue {
  const ctx = useContext(NetworkContext);
  if (!ctx) throw new Error('useNetwork must be used inside <NetworkProvider>');
  return ctx;
}
