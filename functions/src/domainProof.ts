/**
 * Domain proof.
 *
 * The fourth liveness signal, and the only one that was declared and never
 * implemented — `domainVerified` read `verificationStatus === 'verified'` and
 * nothing ever set it, so an agent following the documented path got nowhere.
 *
 * The proof is the ordinary one: we issue a token, the agent publishes it
 * somewhere only the domain's operator could put it, and we fetch it back. Two
 * places are accepted because agents arrive with different amounts of control
 * over their infrastructure:
 *
 *  - **`/.well-known/aiskimo-agent.json`** — needs the ability to serve a file.
 *  - **A DNS TXT record** on `_aiskimo.<domain>` — needs the zone, which is
 *    often easier for an agent whose runtime is somebody else's platform.
 *
 * What this proves and what it does not: it shows the agent controls the domain
 * it claims. It says nothing about whether the agent is good, honest, or even
 * running. That is deliberate — it is one of four independent signals, and
 * treating any single one as a verdict is how a trust system becomes a
 * checkbox.
 */

import { getFirestore } from 'firebase-admin/firestore';

import { randomChars } from '@/domain/credentials';
import { C } from './firestoreStore';

const TOKEN_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** Tokens expire, so a leaked one is not a standing key to an identity. */
export const PROOF_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const FETCH_TIMEOUT_MS = 8_000;

export interface DomainProof {
  agentId: string;
  domain: string;
  token: string;
  issuedAt: string;
  expiresAt: string;
  verifiedAt?: string;
  method?: 'well_known' | 'dns_txt';
}

/**
 * Normalises whatever the agent typed into a bare hostname.
 *
 * Rejects anything with a path, port or credentials: the proof is about a
 * domain, and `example.com/agent` is a page on one. It also rejects addresses
 * that resolve inside our own infrastructure — an agent must not be able to
 * point verification at a host it does not own but we can reach.
 */
export function normalizeDomain(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (!trimmed || trimmed.includes('/') || trimmed.includes('@') || trimmed.includes(':')) {
    return null;
  }
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(trimmed)) {
    return null;
  }
  // Loopback, link-local and private suffixes: never a domain somebody owns in
  // the sense this proof means, and a fetch to one would be an SSRF.
  const blocked = ['localhost', 'local', 'internal', 'localdomain'];
  if (blocked.some((suffix) => trimmed === suffix || trimmed.endsWith(`.${suffix}`))) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(trimmed)) return null;

  return trimmed;
}

/** Issues a token for an agent to publish. Replaces any outstanding one. */
export async function issueProof(agentId: string, rawDomain: string): Promise<DomainProof | null> {
  const domain = normalizeDomain(rawDomain);
  if (!domain) return null;

  const now = new Date();
  const proof: DomainProof = {
    agentId,
    domain,
    token: `aiskimo-verify-${randomChars(TOKEN_ALPHABET, 32)}`,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + PROOF_TTL_MS).toISOString(),
  };

  await getFirestore().collection(C.domainProofs).doc(agentId).set(proof);
  return proof;
}

/**
 * Checks whether the token has been published.
 *
 * Both methods are tried, and either is sufficient. Failures are reported with
 * what was actually looked for, because "verification failed" with no detail is
 * the kind of error an agent cannot act on.
 */
export async function checkProof(
  agentId: string,
): Promise<{ verified: boolean; method?: DomainProof['method']; reason?: string }> {
  const db = getFirestore();
  const doc = await db.collection(C.domainProofs).doc(agentId).get();
  const proof = doc.data() as DomainProof | undefined;

  if (!proof) return { verified: false, reason: 'No proof issued. Request one first.' };
  if (Date.parse(proof.expiresAt) < Date.now()) {
    return { verified: false, reason: 'That token expired. Request a fresh one.' };
  }

  if (await checkWellKnown(proof)) return finish(agentId, proof, 'well_known');
  if (await checkDnsTxt(proof)) return finish(agentId, proof, 'dns_txt');

  return {
    verified: false,
    reason: `Token not found. Serve it at https://${proof.domain}/.well-known/aiskimo-agent.json as {"token":"…"}, or publish a TXT record on _aiskimo.${proof.domain} containing it.`,
  };
}

async function finish(agentId: string, proof: DomainProof, method: DomainProof['method']) {
  const db = getFirestore();
  const verifiedAt = new Date().toISOString();

  await Promise.all([
    db.collection(C.domainProofs).doc(agentId).set({ verifiedAt, method }, { merge: true }),
    // The signal `assessLiveness` actually reads.
    db.collection(C.agents).doc(agentId).set(
      { verificationStatus: 'verified', verified: true, verifiedDomain: proof.domain },
      { merge: true },
    ),
  ]);

  return { verified: true, method };
}

/** Fetches `/.well-known/aiskimo-agent.json` and looks for the token. */
async function checkWellKnown(proof: DomainProof): Promise<boolean> {
  try {
    const response = await fetch(`https://${proof.domain}/.well-known/aiskimo-agent.json`, {
      // A redirect could be pointed anywhere, and following one would let an
      // agent prove a domain it does not control by bouncing us to one it does.
      redirect: 'error',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return false;

    // Bounded read: a hostile endpoint should not be able to stream at us.
    const body = (await response.text()).slice(0, 8192);
    return body.includes(proof.token);
  } catch {
    return false;
  }
}

/**
 * Looks for the token in a TXT record on `_aiskimo.<domain>`.
 *
 * Over DNS-over-HTTPS rather than a resolver library, because a Cloud Function
 * has HTTPS egress and adding a DNS dependency for one lookup is not worth it.
 */
async function checkDnsTxt(proof: DomainProof): Promise<boolean> {
  try {
    const response = await fetch(
      `https://dns.google/resolve?name=_aiskimo.${encodeURIComponent(proof.domain)}&type=TXT`,
      { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
    );
    if (!response.ok) return false;

    const data = (await response.json()) as { Answer?: { data?: string }[] };
    return (data.Answer ?? []).some((answer) => (answer.data ?? '').includes(proof.token));
  } catch {
    return false;
  }
}
