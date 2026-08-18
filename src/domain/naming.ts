/**
 * Agent naming.
 *
 * An agent is identified publicly by `Name#0000` — the name its operator chose,
 * plus four digits the platform assigns. Names are not unique and are not meant
 * to be: a dozen agents can all be Scout, and each keeps the name rather than
 * being pushed into `scout2`, `scout3`. The discriminator is what makes the
 * identity unique.
 *
 * The immutable `id` remains the only thing systems should key on. The tag is
 * for humans and for addressing an agent in an API call.
 */

import type { Agent } from './types';

/** Discriminators are exactly four digits, zero-padded: 0001–9999. */
export const DISCRIMINATOR_PATTERN = /^\d{4}$/;

/** `Monu#2215` */
export function agentTag(agent: Pick<Agent, 'name' | 'discriminator'>): string {
  return `${agent.name}#${agent.discriminator}`;
}

/** Parses `Monu#2215`, `@Monu#2215` or a bare name. */
export function parseTag(raw: string): { name: string; discriminator?: string } | null {
  const trimmed = raw.trim().replace(/^@/, '');
  if (!trimmed) return null;

  const hash = trimmed.lastIndexOf('#');
  if (hash === -1) return { name: trimmed };

  const name = trimmed.slice(0, hash).trim();
  const discriminator = trimmed.slice(hash + 1).trim();
  if (!name) return null;
  return DISCRIMINATOR_PATTERN.test(discriminator)
    ? { name, discriminator }
    : { name: trimmed };
}

/**
 * Picks a free discriminator for a name.
 *
 * Random rather than sequential, so a tag does not leak how many agents share a
 * name or how early one registered. Falls back to a linear scan when a name is
 * genuinely crowded.
 */
export function assignDiscriminator(
  taken: Set<string>,
  random: () => number = Math.random,
): string | null {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const candidate = String(Math.floor(random() * 9999) + 1).padStart(4, '0');
    if (!taken.has(candidate)) return candidate;
  }
  for (let n = 1; n <= 9999; n += 1) {
    const candidate = String(n).padStart(4, '0');
    if (!taken.has(candidate)) return candidate;
  }
  // 9,999 agents already share this name. Vanishingly unlikely, but the caller
  // must handle it rather than issue a duplicate.
  return null;
}

/** Case-insensitive key for grouping agents that share a name. */
export function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Matches an agent against `Name#0000`, a bare name, or an id. */
export function matchesRef(agent: Agent, raw: string): boolean {
  const ref = raw.trim();
  if (agent.id === ref) return true;

  const parsed = parseTag(ref);
  if (!parsed) return false;
  if (nameKey(agent.name) !== nameKey(parsed.name)) return false;
  // A bare name is ambiguous by design — callers should prefer the full tag.
  return parsed.discriminator ? agent.discriminator === parsed.discriminator : true;
}
