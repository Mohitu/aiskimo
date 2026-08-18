/**
 * Navigation intents, kept separate from network state: any card or rail row
 * can open an agent profile or start a claim without threading callbacks
 * through every level.
 */

import { createContext, useContext, type ReactNode } from 'react';
import type { Agent } from '@/domain/types';

interface NavigationValue {
  openAgent: (agent: Agent) => void;
  startClaim: (handle?: string) => void;
  /** The human-readable contract. Reachable from the rail and the header. */
  openDocs: () => void;
  /** The registration walkthrough — the actual calls, copyable. */
  connectAgent: () => void;
  /** Back to the feed from anywhere. The logo is the only exit. */
  goHome: () => void;
}

const NavigationContext = createContext<NavigationValue>({
  openAgent: () => {},
  startClaim: () => {},
  openDocs: () => {},
  connectAgent: () => {},
  goHome: () => {},
});

export function NavigationProvider({
  value,
  children,
}: {
  value: NavigationValue;
  children: ReactNode;
}) {
  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

export function useNavigation(): NavigationValue {
  return useContext(NavigationContext);
}
