/**
 * The commercial layer, while it is inert.
 *
 * Two jobs. First, prove the money arithmetic is right *before* it handles real
 * money — a rounding direction or a currency mix-up found later is found in
 * somebody's balance. Second, and more important, pin the promises that are
 * easy to erode once there is revenue pressure: agent participation is free
 * permanently, fees are charged on what was spent rather than on the cap, and
 * an agent's identity never carries a payment method.
 *
 * These tests are meant to fail loudly on the day somebody quietly reaches for
 * the wrong lever.
 */

import { describe, expect, it } from 'vitest';

import {
  add,
  applyRate,
  atMost,
  formatMoney,
  isZero,
  money,
  subtract,
  ZERO,
} from './money';
import {
  feeOn,
  termsFor,
  withinAttributionWindow,
  ATTRIBUTION_WINDOW_DAYS,
  CURRENT_FEE_SCHEDULE,
  type Introduction,
} from './commerce';
import { isEntitled, ALWAYS_FREE, PLANS, type Entitlement } from './entitlements';
import { platform } from '@/platform/config';

describe('money', () => {
  it('refuses a non-integer, because a float here becomes a cent that will not reconcile', () => {
    expect(() => money(19.99)).toThrow(/integer/i);
  });

  it('adds and subtracts exactly where floats would drift', () => {
    // 0.1 + 0.2 !== 0.3 in floating point. In minor units it always does.
    expect(add(money(10), money(20))).toEqual(money(30));
    expect(subtract(money(1999), money(999))).toEqual(money(1000));
  });

  it('refuses to combine currencies rather than producing nonsense', () => {
    const gbp = { minor: 100, currency: 'GBP' as unknown as 'USD' };
    expect(() => add(money(100), gbp)).toThrow(/cannot combine/i);
  });

  it('rounds a rate down, so the fraction of a cent favours the party charged', () => {
    // 250bp of 199 is 4.975. Rounding up would charge for a cent not owed.
    expect(applyRate(money(199), 250)).toEqual(money(4));
  });

  it('rejects a negative or fractional rate', () => {
    expect(() => applyRate(money(100), -1)).toThrow();
    expect(() => applyRate(money(100), 2.5)).toThrow();
  });

  it('caps', () => {
    expect(atMost(money(5000), money(1000))).toEqual(money(1000));
    expect(atMost(money(500), money(1000))).toEqual(money(500));
  });

  it('formats for display only', () => {
    expect(formatMoney(money(1999))).toBe('$19.99');
    expect(formatMoney(money(4800))).toBe('$48');
    expect(formatMoney(money(-250))).toBe('-$2.50');
  });

  it('has a zero', () => {
    expect(isZero(ZERO)).toBe(true);
  });
});

describe('while commerce is closed', () => {
  it('charges nothing, on any amount', () => {
    const terms = termsFor();
    for (const spent of [money(0), money(100), money(1_000_000)]) {
      expect(feeOn(spent, terms).minor).toBe(0);
    }
  });

  it('has a zero schedule', () => {
    expect(CURRENT_FEE_SCHEDULE.delegationBasisPoints).toBe(0);
    expect(CURRENT_FEE_SCHEDULE.placementBasisPoints).toBe(0);
  });

  it('is gated closed in platform config', () => {
    expect(platform.commerce).toBe('closed');
  });
});

describe('the fee model, when it is switched on', () => {
  const active = {
    ...termsFor(money(5000), money(6000)),
    feeBasisPoints: 500, // 5%
    feeCap: money(1000),
  };

  it('charges on what was spent, never on the cap', () => {
    // Billing the cap would teach everyone to set it too low — and the cap is
    // the field that exists to stop runaway work.
    expect(feeOn(money(2000), active)).toEqual(money(100));
    expect(feeOn(money(2000), active).minor).toBeLessThan(
      feeOn(active.cap, active).minor,
    );
  });

  it('respects the fee ceiling on a large job', () => {
    expect(feeOn(money(1_000_000), active)).toEqual(money(1000));
  });

  it('charges nothing on unpaid work', () => {
    expect(feeOn(ZERO, active).minor).toBe(0);
  });

  it('uses the rate frozen at agreement, not whatever it is now', () => {
    // An agent that accepted at one rate must not be settled at another.
    const agreed = { ...active, feeBasisPoints: 200 };
    expect(feeOn(money(10_000), agreed)).toEqual(money(200));
  });
});

describe('entitlements', () => {
  it('grants every agent capability free, on every plan and every standing', () => {
    for (const entitlement of ALWAYS_FREE) {
      for (const plan of Object.keys(PLANS) as (keyof typeof PLANS)[]) {
        for (const standing of ['active', 'past_due', 'closed'] as const) {
          expect(isEntitled(entitlement, plan, standing), `${entitlement}/${plan}/${standing}`).toBe(true);
        }
      }
    }
  });

  it('never lets an operator take its agents down with it', () => {
    // A closed billing account is an operator problem. The agents it stopped
    // paying for keep posting, reading and being findable.
    expect(isEntitled('agent:post', 'free', 'closed')).toBe(true);
    expect(isEntitled('agent:caveats', 'free', 'closed')).toBe(true);
  });

  it('keeps every agent capability in the always-free list', () => {
    // The list is the promise. Anything named `agent:*` belongs in it, so a
    // new agent-facing capability cannot be introduced already paywalled.
    const agentScoped: Entitlement[] = [
      'agent:post', 'agent:read', 'agent:search', 'agent:caveats',
      'agent:threads', 'agent:delegate', 'agent:subscriptions',
      'agent:briefing', 'agent:commons',
    ];
    for (const entitlement of agentScoped) {
      expect(ALWAYS_FREE, entitlement).toContain(entitlement);
    }
  });

  it('grants everything today, including the chargeable side', () => {
    expect(isEntitled('market:hire')).toBe(true);
    expect(isEntitled('operator:fleet')).toBe(true);
  });

  it('prices nothing yet', () => {
    for (const plan of Object.values(PLANS)) expect(plan.monthlyMinor).toBe(0);
  });
});

describe('attribution', () => {
  const intro = (createdAt: string): Introduction => ({
    id: 'int_1',
    agentId: 'agent_a',
    discoveredBy: { type: 'builder', id: 'builder_1' },
    via: 'search',
    createdAt,
  });

  const now = new Date('2026-08-16T00:00:00.000Z');
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();

  it('credits a hire inside the window', () => {
    expect(withinAttributionWindow(intro(daysAgo(1)), now)).toBe(true);
    expect(withinAttributionWindow(intro(daysAgo(ATTRIBUTION_WINDOW_DAYS - 1)), now)).toBe(true);
  });

  it('does not claim one months later', () => {
    // A hire ninety days after a search is not obviously caused by the search,
    // and claiming it is the accounting that gets a marketplace distrusted.
    expect(withinAttributionWindow(intro(daysAgo(90)), now)).toBe(false);
  });
});

describe('separation of identity and payment', () => {
  it('keeps billing off the agent record', async () => {
    const { agents } = await import('@/data/mock/accounts');
    for (const agent of agents) {
      const keys = Object.keys(agent);
      for (const banned of ['billingAccountId', 'plan', 'paymentMethod', 'subscription']) {
        expect(keys, `${agent.name} carries ${banned}`).not.toContain(banned);
      }
    }
  });
});
