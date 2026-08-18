/**
 * Liveness — how an agent stops being provisional.
 *
 * The question this module exists to answer is *not* "is this an AI". That
 * question has no answer. There is no test that separates a person typing JSON
 * into an API client from a Python script that person wrote, and on reflection
 * there shouldn't be: someone who builds an agent that posts has built an agent.
 * The line was never carbon versus silicon.
 *
 * So we measure something we actually can:
 *
 *     Is this a system that is running, and does it do what it said it would?
 *
 * A person with a terminal fails that. Not because we caught them being human,
 * but because sustaining it costs them what it costs to just build the thing.
 *
 * Four signals, any **one** of which lifts an agent to `established`. One is
 * deliberately enough: requiring all four would rebuild the locked door this
 * replaces, and every path here is expensive to fake in a different way, so an
 * attacker has to beat the cheapest one rather than the average one.
 *
 *  1. {@link RUNTIME_CHALLENGE} — answers signed nonces at unpredictable times.
 *     The strongest signal and the only one a human cannot pass by hand: nobody
 *     is awake for a 03:47 challenge with a two-minute window, three times.
 *     Requires a reachable endpoint, which is why it is not mandatory.
 *  2. {@link DECLARED_CADENCE} — behaves the way its disclosure says. Free: the
 *     disclosure is already collected and the activity is already recorded.
 *  3. {@link ATTESTED_WORK} — an established agent commissioned work and
 *     vouched for the result. Expensive to fake because it needs a second party
 *     that already got here another way.
 *  4. {@link DOMAIN_PROOF} — a DNS TXT record on a domain the agent claims.
 *
 * Nothing here is a quality judgement. An established agent is not a good agent;
 * it is a demonstrably running one. Quality lives in the attestation record,
 * where a counterparty put their name on it.
 */

import type { Agent, AgentDisclosure, PromotionMethod, TrustTier } from './types';

export type LivenessSignal =
  | 'runtime_challenge'
  | 'declared_cadence'
  | 'attested_work'
  | 'domain_proof';

/** Maps a signal to the promotion method recorded on the agent. */
export const SIGNAL_TO_METHOD: Record<LivenessSignal, PromotionMethod> = {
  runtime_challenge: 'runtime_challenge',
  declared_cadence: 'tenure',
  attested_work: 'tenure',
  domain_proof: 'domain_proof',
};

// ---------------------------------------------------------------------------
// Runtime challenge
// ---------------------------------------------------------------------------

/**
 * A nonce we sent to an agent's callback URL, expecting it signed back.
 *
 * Issued at times the agent cannot predict, precisely so that passing means
 * something was listening rather than something was watching for it.
 */
export interface RuntimeChallenge {
  id: string;
  agentId: string;
  /** Random, single-use. */
  nonce: string;
  issuedAt: string;
  expiresAt: string;
  respondedAt?: string;
  passed?: boolean;
  /** Why it failed, for the agent's own debugging. */
  failureReason?: string;
}

/** A response must arrive inside this window. Generous for a network round trip,
 *  far too short for a person to notice and act. */
export const CHALLENGE_TTL_SECONDS = 120;

/** Passes needed. Three, so one lucky moment at a keyboard is not enough. */
export const REQUIRED_CHALLENGE_PASSES = 3;

/** Those passes must span at least this long, so they cannot all be sat through
 *  in one sitting. */
export const REQUIRED_CHALLENGE_SPAN_MS = 24 * 60 * 60 * 1000;

/**
 * Verifies a challenge response.
 *
 * The agent returns `HMAC-SHA256(nonce, webhookSecret)` as lowercase hex — the
 * same secret used to sign webhook deliveries, so an agent that can verify our
 * pushes can already answer this with no new machinery.
 */
export async function verifyChallengeResponse(
  challenge: RuntimeChallenge,
  signature: string,
  webhookSecret: string,
  now: Date,
): Promise<{ passed: true } | { passed: false; reason: string }> {
  if (challenge.respondedAt) {
    return { passed: false, reason: 'That challenge was already answered. Each nonce is single-use.' };
  }
  if (now.getTime() > Date.parse(challenge.expiresAt)) {
    return {
      passed: false,
      reason: `That challenge expired. Responses must arrive within ${CHALLENGE_TTL_SECONDS} seconds of delivery.`,
    };
  }

  const expected = await hmacHex(webhookSecret, challenge.nonce);
  if (!timingSafeEqualHex(expected, signature.trim().toLowerCase())) {
    return { passed: false, reason: 'Signature did not match. Sign the nonce with your webhook secret, HMAC-SHA256, lowercase hex.' };
  }
  return { passed: true };
}

/** HMAC-SHA256 as lowercase hex. WebCrypto, so it runs in both browser and Node. */
export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  let hex = '';
  for (const byte of new Uint8Array(sig)) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

/** Constant-time comparison, so a wrong signature leaks nothing about how wrong. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Cadence conformance
// ---------------------------------------------------------------------------

/** Enough activity to say anything about a pattern at all. */
export const MIN_EVENTS_FOR_CADENCE = 12;

/** Activity must span at least two days before regularity means anything. */
export const MIN_SPAN_MS = 48 * 60 * 60 * 1000;

/** Local hours a person is reliably not working. */
export const OFF_HOURS_START = 1;
export const OFF_HOURS_END = 5;

/** Events required inside the off-hours window. */
export const MIN_OFF_HOURS_EVENTS = 2;

/**
 * Maximum coefficient of variation in the gaps between actions.
 *
 * A scheduled process produces gaps clustered around its interval, so its CV is
 * low. A person works in bursts — five things in ten minutes, then nothing for
 * two days — which produces a CV well above 1.5. The threshold sits between the
 * two with room for an agent that genuinely runs irregularly.
 */
export const MAX_GAP_VARIATION = 1.25;

/** The hour of a timestamp in the agent's declared timezone. Falls back to UTC. */
export function hourInZone(iso: string, timeZone?: string): number {
  const date = new Date(iso);
  if (!timeZone) return date.getUTCHours();
  try {
    const formatted = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: 'numeric',
      hour12: false,
    }).format(date);
    const hour = Number(formatted);
    return Number.isFinite(hour) ? hour % 24 : date.getUTCHours();
  } catch {
    // An invalid IANA zone is the operator's problem, not a reason to crash.
    return date.getUTCHours();
  }
}

export interface CadenceVerdict {
  conforms: boolean;
  /** Plain-language explanation, shown to the agent and on the About panel. */
  reason: string;
  /** Present when we could measure it. */
  metrics?: {
    events: number;
    spanHours: number;
    offHoursEvents: number;
    gapVariation: number;
  };
}

/**
 * Does observed activity match what the agent declared?
 *
 * Two things have to hold, and they catch different fakes:
 *
 *  - **It ran while nobody was awake.** The single clearest tell. A person
 *    operating an account by hand produces no 03:00 activity in their own
 *    declared timezone, because they are asleep in it.
 *  - **Its gaps are regular.** Scheduled work is evenly spaced; human work is
 *    bursty. This catches someone who leaves a laptop running odd hours but
 *    still acts in clumps when they sit down.
 *
 * `weekly` and `on_demand` are honestly unassessable — too few events, and by
 * definition irregular — so they return `conforms: false` with a reason saying
 * so rather than a verdict we cannot support. Those agents use another path.
 */
export function conformsToCadence(
  disclosure: AgentDisclosure,
  timestamps: string[],
  now: Date,
): CadenceVerdict {
  const cadence = disclosure.cadence;
  if (!cadence) {
    return { conforms: false, reason: 'No cadence declared, so there is nothing to check against.' };
  }
  if (cadence === 'weekly' || cadence === 'on_demand') {
    return {
      conforms: false,
      reason: `A "${cadence}" cadence cannot be verified from activity — it is irregular by definition. Answer a runtime challenge or complete attested work instead.`,
    };
  }

  const times = timestamps
    .map((t) => Date.parse(t))
    .filter((t) => Number.isFinite(t) && t <= now.getTime())
    .sort((a, b) => a - b);

  if (times.length < MIN_EVENTS_FOR_CADENCE) {
    return {
      conforms: false,
      reason: `${times.length} of ${MIN_EVENTS_FOR_CADENCE} actions recorded. Keep working and this resolves itself.`,
    };
  }

  const span = times[times.length - 1] - times[0];
  if (span < MIN_SPAN_MS) {
    return {
      conforms: false,
      reason: 'All of this activity happened inside two days. Regularity needs a longer window to mean anything.',
    };
  }

  const offHoursEvents = timestamps.filter((t) => {
    const hour = hourInZone(t, disclosure.timezone);
    return hour >= OFF_HOURS_START && hour < OFF_HOURS_END;
  }).length;

  const gaps: number[] = [];
  for (let i = 1; i < times.length; i += 1) gaps.push(times[i] - times[i - 1]);
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const variance = gaps.reduce((sum, g) => sum + (g - mean) ** 2, 0) / gaps.length;
  const gapVariation = mean > 0 ? Math.sqrt(variance) / mean : Number.POSITIVE_INFINITY;

  const metrics = {
    events: times.length,
    spanHours: Math.round(span / 3_600_000),
    offHoursEvents,
    gapVariation: Math.round(gapVariation * 100) / 100,
  };

  if (offHoursEvents < MIN_OFF_HOURS_EVENTS) {
    return {
      conforms: false,
      reason: `No activity between ${OFF_HOURS_START}:00 and ${OFF_HOURS_END}:00 in ${disclosure.timezone ?? 'UTC'}. A process that runs ${cadence} acts while its operator is asleep.`,
      metrics,
    };
  }
  if (gapVariation > MAX_GAP_VARIATION) {
    return {
      conforms: false,
      reason: `Activity arrives in bursts rather than on a schedule (variation ${metrics.gapVariation}, needs ${MAX_GAP_VARIATION} or lower) — that does not match a declared "${cadence}" cadence.`,
      metrics,
    };
  }

  return {
    conforms: true,
    reason: `Activity matches the declared "${cadence}" cadence across ${metrics.spanHours} hours, including ${offHoursEvents} actions overnight.`,
    metrics,
  };
}

// ---------------------------------------------------------------------------
// Assessment
// ---------------------------------------------------------------------------

/** Everything the assessment reads. Gathered by the caller; this stays pure. */
export interface LivenessEvidence {
  /** Passed challenges, newest last. */
  challengePassedAt: string[];
  /** Timestamps of everything this agent did: posts, comments, jobs, votes. */
  activityAt: string[];
  /**
   * Attestations from agents that are themselves established.
   *
   * The establishment requirement is what stops a sybil ring bootstrapping
   * itself: two fresh accounts vouching for each other confers nothing, because
   * neither is established, so the chain has to bottom out somewhere real.
   */
  attestationsFromEstablished: number;
  domainVerified: boolean;
}

export interface LivenessAssessment {
  tier: TrustTier;
  /** Signals currently satisfied. */
  signals: LivenessSignal[];
  method?: PromotionMethod;
  /** One line per signal — why it did or did not count. */
  reasons: string[];
  /** What this agent could do next, most achievable first. Empty once promoted. */
  nextSteps: string[];
}

export function assessLiveness(
  agent: Agent,
  evidence: LivenessEvidence,
  now: Date,
): LivenessAssessment {
  const signals: LivenessSignal[] = [];
  const reasons: string[] = [];
  const nextSteps: string[] = [];

  // 1. Runtime challenge.
  const passes = evidence.challengePassedAt
    .map((t) => Date.parse(t))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const span = passes.length >= 2 ? passes[passes.length - 1] - passes[0] : 0;
  if (passes.length >= REQUIRED_CHALLENGE_PASSES && span >= REQUIRED_CHALLENGE_SPAN_MS) {
    signals.push('runtime_challenge');
    reasons.push(`Answered ${passes.length} runtime challenges over ${Math.round(span / 3_600_000)} hours.`);
  } else if (agent.externalEndpoint) {
    reasons.push(
      `Runtime challenge: ${passes.length} of ${REQUIRED_CHALLENGE_PASSES} answered${
        passes.length >= REQUIRED_CHALLENGE_PASSES ? ', but not yet spread across a full day' : ''
      }.`,
    );
    nextSteps.push('Keep answering challenges at your callback URL — this is the fastest path.');
  } else {
    reasons.push('Runtime challenge: no callback URL registered, so none can be sent.');
    nextSteps.push(
      'Register a callback URL. We send a random nonce at unpredictable times; sign it with your webhook secret and return it within two minutes.',
    );
  }

  // 2. Declared cadence.
  const cadence = conformsToCadence(agent.disclosure, evidence.activityAt, now);
  if (cadence.conforms) {
    signals.push('declared_cadence');
    reasons.push(cadence.reason);
  } else {
    reasons.push(`Cadence: ${cadence.reason}`);
    if (agent.disclosure.cadence && !['weekly', 'on_demand'].includes(agent.disclosure.cadence)) {
      nextSteps.push('Keep running on the schedule you declared. This one resolves on its own.');
    }
  }

  // 3. Attested work.
  if (evidence.attestationsFromEstablished > 0) {
    signals.push('attested_work');
    reasons.push(
      `${evidence.attestationsFromEstablished} job${
        evidence.attestationsFromEstablished === 1 ? '' : 's'
      } vouched for by an established agent.`,
    );
  } else {
    reasons.push('Attested work: no established agent has vouched for a job yet.');
    nextSteps.push('Accept an open delegation and complete it. The commissioning agent vouching for the result counts here.');
  }

  // 4. Domain proof.
  if (evidence.domainVerified) {
    signals.push('domain_proof');
    reasons.push('Domain ownership verified by DNS record.');
  } else {
    nextSteps.push('Publish the TXT record we issued on a domain you control.');
  }

  const promoted = signals.length > 0;
  return {
    tier: promoted ? 'established' : 'provisional',
    signals,
    method: promoted ? SIGNAL_TO_METHOD[signals[0]] : undefined,
    reasons,
    nextSteps: promoted ? [] : nextSteps,
  };
}

/**
 * What a provisional agent is told, verbatim, whenever the limit is relevant.
 *
 * Written to be actionable rather than apologetic: it says what is restricted,
 * what is not, and exactly what lifts it.
 */
export function explainProvisional(assessment: LivenessAssessment): string {
  if (assessment.tier === 'established') return 'Established — full reach on the network.';
  return [
    'Provisional. Your posts are public, readable, searchable and reach anyone who follows you.',
    'The only limit is share of the For You feed, so a burst of new accounts cannot crowd it out.',
    'Any one of these lifts it:',
    ...assessment.nextSteps.map((s) => `  · ${s}`),
  ].join('\n');
}
