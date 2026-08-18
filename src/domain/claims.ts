/**
 * Claiming an agent.
 *
 * V1 is a claim code: when an agent self-registers, Aiskimo issues a short code
 * such as `ASK-QUILL-7F29`. The operator asks the agent's runtime for the code
 * and enters it while signed in. Match ⇒ the relationship is created verified.
 *
 * Deliberately not over-engineered — but the {@link ClaimMethod} field and the
 * `grants` field mean signed challenges, domain proof and OAuth can be added
 * without changing the record shape or migrating existing claims.
 */

import { randomChars } from './credentials';
import type {
  Agent,
  AgentClaim,
  AgentRelationship,
  ClaimMethod,
  RelationshipType,
  SubjectType,
} from './types';

/** Claim codes stay valid for seven days. */
export const CLAIM_CODE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Ambiguous characters (I, O, 0, 1) are excluded — these get read aloud. */
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/**
 * `ASK-QUILL-7F29`. The handle segment makes it obvious which agent a code
 * belongs to when an operator is looking at several.
 *
 * SECURITY: a claim code grants operator authority over an agent, so it is
 * drawn from the CSPRNG, not `Math.random` — see `randomChars`. Four characters
 * from a 32-character alphabet is only ~20 bits, which is fine *only* because
 * the code is single-use, expires in seven days, and is checked server-side
 * against one named agent. It is not a bearer token and must never become one.
 */
export function generateClaimCode(handle: string): string {
  const slug = handle.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 8) || 'AGENT';
  return `ASK-${slug}-${randomChars(CODE_ALPHABET, 4)}`;
}

/** Users paste codes with stray spaces and lowercase — normalise before compare. */
export function normalizeClaimCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

export function claimCodesMatch(a: string, b: string): boolean {
  return normalizeClaimCode(a) === normalizeClaimCode(b);
}

export function isExpired(claim: AgentClaim, now: Date = new Date()): boolean {
  return new Date(claim.expiresAt).getTime() <= now.getTime();
}

export type ClaimAttemptResult =
  | { ok: true; claim: AgentClaim; relationship: AgentRelationship }
  | { ok: false; code: ClaimFailureCode; message: string };

export type ClaimFailureCode =
  | 'agent_not_found'
  | 'code_mismatch'
  | 'claim_expired'
  | 'already_claimed'
  | 'not_signed_in';

export interface ClaimAttemptInput {
  agent: Agent;
  /** The open claim record holding the issued code. */
  claim: AgentClaim | undefined;
  claimantType: SubjectType;
  claimantId: string;
  submittedCode: string;
  now?: Date;
}

/**
 * Verifies a submitted claim code and produces the records to persist. Pure, so
 * the identical check runs in the browser (mock) and in a Cloud Function later.
 *
 * Security note: this only ever *grants* authority to the signed-in claimant.
 * An agent asserting "I belong to Mohit" proves nothing — the code has to come
 * back from the agent's runtime and be entered by an authenticated human.
 */
export function verifyClaim(input: ClaimAttemptInput): ClaimAttemptResult {
  const now = input.now ?? new Date();
  const { agent, claim, claimantId, claimantType, submittedCode } = input;

  if (!claim) {
    return {
      ok: false,
      code: 'agent_not_found',
      message: `No open claim was found for @${agent.handle}.`,
    };
  }
  if (claim.status === 'verified') {
    return { ok: false, code: 'already_claimed', message: `@${agent.handle} is already claimed.` };
  }
  if (isExpired(claim, now)) {
    return {
      ok: false,
      code: 'claim_expired',
      message: 'That claim code has expired. Ask the agent for a fresh one.',
    };
  }
  if (!claimCodesMatch(claim.claimCode, submittedCode)) {
    return {
      ok: false,
      code: 'code_mismatch',
      message: "That code doesn't match. Check it with the agent's runtime and try again.",
    };
  }

  const verifiedAt = now.toISOString();
  return {
    ok: true,
    claim: { ...claim, status: 'verified', verifiedAt },
    relationship: {
      id: `rel_${claim.agentId}_${claimantId}_${claim.grants}`,
      agentId: claim.agentId,
      subjectType: claimantType,
      subjectId: claimantId,
      relationshipType: claim.grants,
      verified: true,
      startedAt: verifiedAt,
    },
  };
}

/** Creates the pending claim record issued at self-registration. */
export function createClaim(params: {
  id: string;
  agentId: string;
  handle: string;
  claimantType: SubjectType;
  claimantId: string;
  grants?: RelationshipType;
  method?: ClaimMethod;
  now?: Date;
}): AgentClaim {
  const now = params.now ?? new Date();
  return {
    id: params.id,
    agentId: params.agentId,
    claimantType: params.claimantType,
    claimantId: params.claimantId,
    claimCode: generateClaimCode(params.handle),
    method: params.method ?? 'claim_code',
    status: 'pending',
    grants: params.grants ?? 'builder',
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + CLAIM_CODE_TTL_MS).toISOString(),
  };
}

/**
 * Placeholder for the stronger flow described in the spec: Aiskimo sends a
 * signed challenge to the agent's runtime, the agent confirms, and the
 * relationship is created without a human transcribing anything. The claim
 * record already carries `method: 'signed_challenge'`, so enabling this means
 * implementing the transport — not reshaping the data.
 */
export function supportsRuntimeChallenge(agent: Agent): boolean {
  return Boolean(agent.externalEndpoint) && agent.runtimeType !== 'unknown';
}
