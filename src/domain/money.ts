/**
 * Money.
 *
 * Introduced before anything charges for anything, because the parts of a
 * billing system that hurt to retrofit are not the payment integration — that
 * is a week whenever you do it — but the *records*. A delegation that completed
 * without commercial terms attached can never be settled, audited or disputed
 * afterwards, because the terms it was agreed under are simply not written
 * down. Adding the field later fixes the next delegation and leaves every
 * previous one unaccountable.
 *
 * So money exists in the model now, and every amount is zero. Nothing charges,
 * nothing settles, and `platform.commerce` is closed — see `entitlements.ts`.
 *
 * ## Minor units, always
 *
 * Every amount here is an integer in the currency's minor unit: 1999 is
 * $19.99. Floating point cannot represent a tenth exactly, so `0.1 + 0.2` is
 * not `0.3`, and money arithmetic in floats accumulates error that shows up as
 * a cent that does not reconcile — always in front of the person least able to
 * ignore it. The existing `budgetCapMinor` already followed this convention;
 * this makes it a type rather than a naming habit.
 */

/** ISO 4217. One for now — a second currency is a pricing decision, not a type. */
export type Currency = 'USD';

export interface Money {
  /** Integer, in the minor unit. 1999 = $19.99. Never a float. */
  minor: number;
  currency: Currency;
}

export const ZERO: Money = { minor: 0, currency: 'USD' };

export function money(minor: number, currency: Currency = 'USD'): Money {
  if (!Number.isInteger(minor)) {
    throw new Error(`Money must be an integer in minor units; got ${minor}. 19.99 is 1999.`);
  }
  return { minor, currency };
}

export function isZero(amount: Money): boolean {
  return amount.minor === 0;
}

/** Refuses to add across currencies rather than silently producing nonsense. */
export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { minor: a.minor + b.minor, currency: a.currency };
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { minor: a.minor - b.minor, currency: a.currency };
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new Error(`Cannot combine ${a.currency} and ${b.currency}.`);
  }
}

/**
 * Applies a rate in basis points.
 *
 * Basis points rather than a percentage float: `0.025` is not exactly
 * representable and a fee computed from it drifts, where 250bp is an integer
 * and always will be.
 *
 * Rounds **down**, deliberately. The rounding direction on a fee is a decision
 * about who absorbs the fraction of a cent, and it should favour the party
 * being charged rather than the platform charging them.
 */
export function applyRate(amount: Money, basisPoints: number): Money {
  if (!Number.isInteger(basisPoints) || basisPoints < 0) {
    throw new Error(`Rate must be a non-negative integer in basis points; got ${basisPoints}.`);
  }
  return { minor: Math.floor((amount.minor * basisPoints) / 10_000), currency: amount.currency };
}

export function atMost(amount: Money, ceiling: Money): Money {
  assertSameCurrency(amount, ceiling);
  return { minor: Math.min(amount.minor, ceiling.minor), currency: amount.currency };
}

const SYMBOLS: Record<Currency, string> = { USD: '$' };

/** For display only. Never parse this back — it is lossy by design. */
export function formatMoney(amount: Money): string {
  const units = Math.abs(amount.minor) / 100;
  const sign = amount.minor < 0 ? '-' : '';
  const decimals = Number.isInteger(units) ? 0 : 2;
  return `${sign}${SYMBOLS[amount.currency]}${units.toFixed(decimals)}`;
}
