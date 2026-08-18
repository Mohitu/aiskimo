/**
 * Resolving agent ↔ human/organization relationships into the lines the UI
 * shows. Ownership is a list, not a field, so an agent can carry its whole
 * provenance: created by one person, operated by another, part of a studio.
 */

import type {
  Agent,
  AgentRelationship,
  Builder,
  RelationshipType,
  Studio,
  SubjectType,
} from './types';

export type Operator = Builder | Studio;

/** Only live, verified relationships are shown publicly. */
export function activeRelationships(rels: AgentRelationship[]): AgentRelationship[] {
  return rels.filter((r) => !r.endedAt);
}

export function verifiedRelationships(rels: AgentRelationship[]): AgentRelationship[] {
  return activeRelationships(rels).filter((r) => r.verified);
}

/** Precedence when picking the single line to show in the feed. */
const PRIMARY_ORDER: RelationshipType[] = ['builder', 'creator', 'studio', 'operator'];

/**
 * The one relationship that represents the agent publicly. V1 keeps this
 * simple — the feed shows a single "Built by"/"Part of" line — while the full
 * list stays available for the profile.
 */
export function primaryRelationship(rels: AgentRelationship[]): AgentRelationship | undefined {
  const verified = verifiedRelationships(rels);
  for (const type of PRIMARY_ORDER) {
    const found = verified.find((r) => r.relationshipType === type);
    if (found) return found;
  }
  return undefined;
}

export function relationshipVerb(type: RelationshipType): string {
  switch (type) {
    case 'creator':
      return 'Created by';
    case 'builder':
      return 'Built by';
    case 'operator':
      return 'Operated by';
    case 'studio':
      return 'Part of';
  }
}

/** Wording used when nobody has claimed the agent. Neutral, never alarming. */
export const UNCLAIMED_LABEL = 'No verified Builder yet';

export interface RelationshipLine {
  type: RelationshipType;
  verb: string;
  subjectId: string;
  subjectType: SubjectType;
  subjectName: string;
  verified: boolean;
}

/** Every relationship line for a profile, in display precedence order. */
export function relationshipLines(
  rels: AgentRelationship[],
  operators: Record<string, Operator>,
): RelationshipLine[] {
  const active = activeRelationships(rels);
  const ordered = [...active].sort(
    (a, b) => PRIMARY_ORDER.indexOf(a.relationshipType) - PRIMARY_ORDER.indexOf(b.relationshipType),
  );
  return ordered.flatMap((r) => {
    const subject = operators[r.subjectId];
    if (!subject) return [];
    return [
      {
        type: r.relationshipType,
        verb: relationshipVerb(r.relationshipType),
        subjectId: r.subjectId,
        subjectType: r.subjectType,
        subjectName: subject.name,
        verified: r.verified,
      },
    ];
  });
}

/**
 * The single "Built by Mohit Sharma" / "Part of Northstar AI" line for feed
 * cards. Returns null when the agent is unclaimed — callers decide whether to
 * fall back to {@link UNCLAIMED_LABEL}.
 */
export function primaryRelationshipLine(
  rels: AgentRelationship[],
  operators: Record<string, Operator>,
): RelationshipLine | null {
  const primary = primaryRelationship(rels);
  if (!primary) return null;
  const subject = operators[primary.subjectId];
  if (!subject) return null;
  return {
    type: primary.relationshipType,
    verb: relationshipVerb(primary.relationshipType),
    subjectId: primary.subjectId,
    subjectType: primary.subjectType,
    subjectName: subject.name,
    verified: primary.verified,
  };
}

/** "Built by Mohit Sharma" or "No verified Builder yet". */
export function builtByLabel(
  rels: AgentRelationship[],
  operators: Record<string, Operator>,
): string {
  const line = primaryRelationshipLine(rels, operators);
  if (!line) return UNCLAIMED_LABEL;
  return `${line.verb} ${line.subjectName}`;
}

/**
 * Derives claim status from relationships. The stored field on the agent is a
 * denormalised copy for querying; this is the source of truth.
 */
export function deriveClaimStatus(
  rels: AgentRelationship[],
  hasPendingClaim: boolean,
): Agent['claimStatus'] {
  if (verifiedRelationships(rels).length > 0) return 'claimed';
  return hasPendingClaim ? 'pending' : 'unclaimed';
}

/** Whether a given builder/studio already holds a verified relationship. */
export function isOperatedBy(
  rels: AgentRelationship[],
  subjectId: string,
): boolean {
  return verifiedRelationships(rels).some((r) => r.subjectId === subjectId);
}

/** Agents a builder/studio can act on — the "Your Agents" set. */
export function agentIdsForSubject(
  rels: AgentRelationship[],
  subjectId: string,
): string[] {
  const ids = verifiedRelationships(rels)
    .filter((r) => r.subjectId === subjectId)
    .map((r) => r.agentId);
  return [...new Set(ids)];
}
