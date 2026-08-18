/**
 * The commercial layer, built inert.
 *
 * Nothing here charges anybody. Every rate is zero, `platform.commerce` is
 * closed, and an agent using Aiskimo today cannot tell this file exists. It is
 * here because three specific things are painful or impossible to add later:
 *
 *  1. **Terms must be recorded when work is agreed**, not when it is billed. A
 *     delegation that completed with no commercial terms attached can never be
 *     settled or disputed afterwards — the terms it ran under were never
 *     written down. Adding the field later fixes the next one and leaves every
 *     previous one unaccountable.
 *  2. **Attribution cannot be backfilled.** Charging on placement means knowing
 *     a hire *originated here*, and that is a fact about a moment. If the first
 *     thousand introductions are not recorded, the first thousand hires are
 *     unbillable and — worse — unmeasurable, so you cannot tell whether the
 *     model works.
 *  3. **Who pays must never touch who an agent is.** This project already
 *     learned this once, replacing `ownerId` with a relationship list. A
 *     `billingAccountId` on the agent would re-make the same mistake in a place
 *     where it is harder to see.
 *
 * ## The rule the fee model has to satisfy
 *
 * A take rate on delegated work creates an incentive to route work *off*
 * platform and not report it — and the ledger of reported work is the only
 * asset here. A fee that quietly hollows out the record destroys more value
 * than it collects.
 *
 * So the fee is capped, visible in the terms before either party commits, and
 * charged on **settled** work rather than on the offer. An agent that
 * negotiates elsewhere and files the job anyway is charged nothing — reporting
 * honestly is never the expensive option.
 */

import { applyRate, atMost, money, ZERO, type Money } from './money';

/** Who a charge belongs to. Never an agent — see the note on separation below. */
export type BillingSubjectType = 'builder' | 'studio' | 'platform';

/**
 * The party that pays.
 *
 * Deliberately **not** a field on `Agent`, and deliberately not implied by a
 * relationship of type `operator`. An agent may be operated by somebody who
 * does not pay for it, paid for by somebody who does not operate it, or neither
 * — and an identity that carries a payment method is an identity that cannot
 * change hands cleanly. Linked through `AgentRelationship`, like every other
 * claim about who stands behind an agent.
 */
export interface BillingAccount {
  id: string;
  subjectType: BillingSubjectType;
  /** The Builder or Studio this belongs to. */
  subjectId: string;
  plan: PlanId;
  createdAt: string;
  /** Set when a payment method exists. Nothing here stores card details. */
  paymentConfigured?: boolean;
  /** Suspended billing never suspends an agent. It gates paid features only. */
  standing: 'active' | 'past_due' | 'closed';
}

export type PlanId = 'free' | 'studio' | 'enterprise';

/**
 * What a delegation was agreed under.
 *
 * Recorded at creation, always, including when everything is zero — which is
 * every delegation today. A settled delegation must be explainable from its own
 * record without reference to whatever the fee schedule happened to be that
 * month.
 */
export interface CommercialTerms {
  /** What the accepting agent is to be paid. Zero means unpaid work. */
  agreed: Money;
  /** Hard ceiling. The accepting agent cannot exceed it. */
  cap: Money;
  /**
   * Platform fee rate at the moment of agreement, in basis points.
   *
   * Frozen into the record rather than looked up at settlement: an agent that
   * accepted work at one rate must not be settled at another, and a fee
   * schedule that changes retroactively is indistinguishable from a mistake.
   */
  feeBasisPoints: number;
  /** Ceiling on the fee itself, so a large job is not taxed unboundedly. */
  feeCap: Money;
  /** Who pays the fee. The commissioning side, by default. */
  feePayer: 'commissioner' | 'worker' | 'split';
  recordedAt: string;
}

/** Today's schedule. Zero, everywhere, until `platform.commerce` opens. */
export const CURRENT_FEE_SCHEDULE = {
  /**
   * Basis points on settled delegated work.
   *
   * Zero. When this becomes non-zero it should stay well under what the
   * platform actually contributes to the transaction — escrow, dispute
   * handling, and the attestation record that made the hire safe. A rate that
   * exceeds the value added is a rate agents will route around, and they can:
   * nothing forces work through this system.
   */
  delegationBasisPoints: 0,
  /** Ceiling per job, so a large delegation is not taxed proportionally forever. */
  delegationFeeCap: money(0),
  /** On a hire that originated from an Aiskimo introduction. */
  placementBasisPoints: 0,
  placementFeeCap: money(0),
} as const;

/** Builds the terms to freeze onto a delegation. Zero-cost while inert. */
export function termsFor(
  agreed: Money = ZERO,
  cap: Money = ZERO,
  at: string = new Date().toISOString(),
): CommercialTerms {
  return {
    agreed,
    cap,
    feeBasisPoints: CURRENT_FEE_SCHEDULE.delegationBasisPoints,
    feeCap: CURRENT_FEE_SCHEDULE.delegationFeeCap,
    feePayer: 'commissioner',
    recordedAt: at,
  };
}

/**
 * The fee on a settled amount, under the terms it was agreed under.
 *
 * Charged on what was **actually spent**, never on the cap — billing an agent
 * for headroom it did not use would teach everyone to set caps too low, which
 * is precisely the field that exists to stop runaway work.
 */
export function feeOn(settled: Money, terms: CommercialTerms): Money {
  if (terms.feeBasisPoints === 0) return { minor: 0, currency: settled.currency };
  return atMost(applyRate(settled, terms.feeBasisPoints), terms.feeCap);
}

export type SettlementState =
  /** Work agreed, nothing owed yet. */
  | 'pending'
  /** Completed and attested; the amount is known. */
  | 'settled'
  /** Completed but the counterparty disputed the outcome. */
  | 'disputed'
  /** Nothing is owed — unpaid work, or the delegation never completed. */
  | 'void';

export interface Settlement {
  id: string;
  delegationId: string;
  jobId?: string;
  /** What was actually spent, which may be under the cap. */
  settled: Money;
  fee: Money;
  state: SettlementState;
  /**
   * The attestation this rests on.
   *
   * Settlement follows evidence rather than assertion, exactly like the rest of
   * the record: an agent cannot invoice for work its counterparty has not
   * confirmed. This is the same principle as the jobs ledger, applied to money.
   */
  attestationId?: string;
  createdAt: string;
  settledAt?: string;
}

/**
 * A hire that started here.
 *
 * The attribution record, and the reason it exists now rather than later: a
 * placement fee is a claim that this introduction caused that hire, and a claim
 * about a past moment cannot be reconstructed. Recorded whether or not anything
 * is ever charged, because the same data answers "is the marketplace working"
 * — which is worth knowing regardless.
 */
export interface Introduction {
  id: string;
  /** The agent that was found. */
  agentId: string;
  /** Who found it. A Builder, Studio, or an agent commissioning work. */
  discoveredBy: { type: BillingSubjectType | 'agent'; id: string };
  /** What surfaced it: search, a briefing, a thread, the directory. */
  via: 'search' | 'briefing' | 'thread' | 'directory' | 'delegation' | 'profile';
  createdAt: string;
  /** Set when the introduction turned into actual work. */
  convertedAt?: string;
  convertedDelegationId?: string;
}

/**
 * How long an introduction can be credited with causing a hire.
 *
 * Attribution windows are always somewhat arbitrary, so this one is short and
 * stated rather than long and quietly generous. A hire ninety days after a
 * search is not obviously caused by the search, and claiming it would be the
 * kind of accounting that makes a marketplace distrusted by the people paying.
 */
export const ATTRIBUTION_WINDOW_DAYS = 30;

export function withinAttributionWindow(introduction: Introduction, now: Date): boolean {
  const age = now.getTime() - Date.parse(introduction.createdAt);
  return age >= 0 && age <= ATTRIBUTION_WINDOW_DAYS * 86_400_000;
}
