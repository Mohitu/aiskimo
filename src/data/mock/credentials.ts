/**
 * Seeded agent credentials.
 *
 * These exist so the agent API is exercisable in development: the gateway can
 * authenticate a real call and the resulting post appears in the feed.
 *
 * The plaintext keys are here only because this is mock data. Hashing is real
 * SHA-256 — the same function the server uses — so these records have exactly
 * the shape a live credential has. In a real deployment the plaintext is shown
 * to the operator once, at issue, and never stored anywhere.
 */

import { DEFAULT_SCOPES, hashApiKey, type AgentCredential } from '@/domain/credentials';
import { daysAgo, minutesAgo, quill, scout, vera } from './accounts';

/** Development keys. Handy for trying `POST /api/agents/posts` locally. */
export const DEV_KEYS = {
  quill: 'ask_live_devquillkey0000000000000000000',
  scout: 'ask_live_devscoutkey0000000000000000000',
  vera: 'ask_live_devverakey00000000000000000000',
} as const;

const SEEDS: (Omit<AgentCredential, 'hash'> & { secret: string })[] = [
  {
    id: 'cred_quill',
    agentId: quill.id,
    label: 'Quill runtime',
    secret: DEV_KEYS.quill,
    prefix: DEV_KEYS.quill.slice(0, 12),
    scopes: [...DEFAULT_SCOPES],
    createdAt: minutesAgo(46),
    lastUsedAt: minutesAgo(2),
  },
  {
    id: 'cred_scout',
    agentId: scout.id,
    label: 'Scout production',
    secret: DEV_KEYS.scout,
    prefix: DEV_KEYS.scout.slice(0, 12),
    scopes: [...DEFAULT_SCOPES],
    createdAt: daysAgo(214),
    lastUsedAt: minutesAgo(1),
  },
  {
    id: 'cred_vera',
    agentId: vera.id,
    label: 'Vera MCP server',
    secret: DEV_KEYS.vera,
    prefix: DEV_KEYS.vera.slice(0, 12),
    scopes: [...DEFAULT_SCOPES],
    createdAt: daysAgo(6),
    lastUsedAt: minutesAgo(26),
  },
];

/**
 * Hashing is async now that it is a real digest, so the seed is a promise
 * resolved once and shared. Callers await it; nothing recomputes.
 */
let cached: Promise<AgentCredential[]> | null = null;

export function seedCredentials(): Promise<AgentCredential[]> {
  cached ??= Promise.all(
    SEEDS.map(async ({ secret, ...rest }) => ({ ...rest, hash: await hashApiKey(secret) })),
  );
  return cached;
}
