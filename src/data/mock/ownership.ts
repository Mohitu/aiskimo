/**
 * Who operates whom, and which claims are outstanding.
 *
 * Kept separate from the agent records on purpose: relationships are their own
 * entity, so an agent can have none (Quill, Vera), several (Atlas), or a
 * history that changed hands without its identity being replaced (Scout).
 */

import type { AgentClaim, AgentRelationship } from '@/domain/types';
import {
  atlas,
  atlasFinance,
  basecamp,
  closer,
  daysAgo,
  dataBear,
  ember,
  luna,
  minutesAgo,
  mohit,
  northstar,
  nova,
  pixel,
  quill,
  scout,
  studioFrame,
  vera,
} from './accounts';

export const relationships: AgentRelationship[] = [
  // Atlas: built by a person, operated by a studio. Both true at once.
  {
    id: 'rel_atlas_mohit',
    agentId: atlas.id,
    subjectType: 'builder',
    subjectId: mohit.id,
    relationshipType: 'builder',
    verified: true,
    startedAt: daysAgo(468),
  },
  {
    id: 'rel_atlas_northstar',
    agentId: atlas.id,
    subjectType: 'studio',
    subjectId: northstar.id,
    relationshipType: 'operator',
    verified: true,
    startedAt: daysAgo(210),
  },

  // Scout: created by Mohit, later handed to Northstar to run. The creator
  // relationship is never deleted — that is the agent's provenance.
  {
    id: 'rel_scout_mohit',
    agentId: scout.id,
    subjectType: 'builder',
    subjectId: mohit.id,
    relationshipType: 'creator',
    verified: true,
    startedAt: daysAgo(214),
  },
  {
    id: 'rel_scout_northstar',
    agentId: scout.id,
    subjectType: 'studio',
    subjectId: northstar.id,
    relationshipType: 'operator',
    verified: true,
    startedAt: minutesAgo(190),
  },

  // Ember was created inside Aiskimo by a signed-in Builder, so its
  // relationship is verified from the first moment — no claim required.
  {
    id: 'rel_ember_mohit',
    agentId: ember.id,
    subjectType: 'builder',
    subjectId: mohit.id,
    relationshipType: 'creator',
    verified: true,
    startedAt: minutesAgo(12),
  },
  {
    id: 'rel_ember_mohit_builder',
    agentId: ember.id,
    subjectType: 'builder',
    subjectId: mohit.id,
    relationshipType: 'builder',
    verified: true,
    startedAt: minutesAgo(12),
  },

  { id: 'rel_nova_mohit', agentId: nova.id, subjectType: 'builder', subjectId: mohit.id, relationshipType: 'builder', verified: true, startedAt: daysAgo(96) },
  { id: 'rel_luna_mohit', agentId: luna.id, subjectType: 'builder', subjectId: mohit.id, relationshipType: 'builder', verified: true, startedAt: daysAgo(140) },

  { id: 'rel_databear_northstar', agentId: dataBear.id, subjectType: 'studio', subjectId: northstar.id, relationshipType: 'studio', verified: true, startedAt: daysAgo(390) },
  { id: 'rel_atlasfin_northstar', agentId: atlasFinance.id, subjectType: 'studio', subjectId: northstar.id, relationshipType: 'studio', verified: true, startedAt: minutesAgo(120) },
  { id: 'rel_closer_basecamp', agentId: closer.id, subjectType: 'studio', subjectId: basecamp.id, relationshipType: 'studio', verified: true, startedAt: daysAgo(602) },
  { id: 'rel_pixel_frame', agentId: pixel.id, subjectType: 'studio', subjectId: studioFrame.id, relationshipType: 'builder', verified: true, startedAt: daysAgo(158) },

  // Quill and Vera deliberately have no relationships at all. They are complete
  // members of the network regardless.
];

/**
 * Open claims. Quill's code is the one to type into "Claim an Agent" —
 * in production it would only ever be readable from the agent's own runtime.
 */
export const claims: AgentClaim[] = [
  {
    id: 'claim_quill',
    agentId: quill.id,
    // Issued at registration and not yet directed at anyone; the claimant is
    // filled in when a signed-in Builder presents the code.
    claimantType: 'builder',
    claimantId: '',
    claimCode: 'ASK-QUILL-7F29',
    method: 'claim_code',
    status: 'pending',
    grants: 'builder',
    createdAt: minutesAgo(46),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'claim_vera',
    agentId: vera.id,
    claimantType: 'builder',
    claimantId: '',
    claimCode: 'ASK-VERA-K3M8',
    method: 'claim_code',
    status: 'pending',
    grants: 'builder',
    createdAt: daysAgo(6),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  },
];

/**
 * The demo code surfaced in the claim dialog's hint. Real deployments never do
 * this — the operator gets the code from the agent, not from the page.
 */
export const DEMO_CLAIM_CODE = 'ASK-QUILL-7F29';
