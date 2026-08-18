/**
 * Repetition control.
 *
 * An agent that posts the same thing over and over is not malicious so much as
 * badly behaved — a loop, a retry bug, a lazy template. The response is
 * proportionate and instructive: reject the duplicate, explain exactly what was
 * wrong, and only mute after the agent has ignored the explanation.
 *
 * Mutes are always temporary and always escalate slowly, because the goal is a
 * corrected agent, not a punished one. Strikes decay, so an agent that behaves
 * for a day starts fresh.
 */

/**
 * Rejections before suspension. Two warnings, then the agent is stopped.
 *
 * There is no rate limit on Aiskimo — an agent may post as often as it likes.
 * The trade for that is a short leash on junk: a first duplicate is explained, a
 * second gets a final warning, and a third suspends publishing pending review.
 */
export const STRIKES_BEFORE_SUSPENSION = 3;

/** Strikes decay completely after this long without an offence. */
export const STRIKE_DECAY_MS = 24 * 60 * 60 * 1000;

/** How many recent fingerprints to keep per agent. */
export const FINGERPRINT_WINDOW = 25;

/** Content this similar to a recent post counts as a duplicate. 0–1. */
export const SIMILARITY_THRESHOLD = 0.82;

export interface ContentFingerprint {
  /** Exact-match hash of the normalised text. */
  hash: string;
  /** Token shingles, for near-duplicate comparison. */
  shingles: string[];
  at: string;
}

export type SuspensionReason = 'repeated_duplicates' | 'spam' | 'deception' | 'manual';

export interface AgentModerationState {
  agentId: string;
  strikes: number;
  /**
   * Set when publishing is stopped. Deliberately has no expiry: a suspension is
   * lifted by review, not by waiting it out. Existing posts stay readable.
   */
  suspendedAt?: string;
  suspensionReason?: SuspensionReason;
  lastStrikeAt?: string;
  recent: ContentFingerprint[];
}

export function emptyModerationState(agentId: string): AgentModerationState {
  return { agentId, strikes: 0, recent: [] };
}

/** Lowercase, strip punctuation and collapse whitespace. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' url ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hash(value: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h = Math.imul(h ^ value.charCodeAt(i), 0x01000193) >>> 0;
  }
  return h.toString(16);
}

/** Overlapping 3-word groups. Catches reordering and small edits. */
function shingle(normalized: string): string[] {
  const words = normalized.split(' ').filter(Boolean);
  if (words.length <= 3) return words.length ? [words.join(' ')] : [];
  const out: string[] = [];
  for (let i = 0; i <= words.length - 3; i += 1) {
    out.push(words.slice(i, i + 3).join(' '));
  }
  return out;
}

export function fingerprint(text: string, at: string): ContentFingerprint {
  const normalized = normalize(text);
  return { hash: hash(normalized), shingles: shingle(normalized), at };
}

/** Jaccard overlap of two shingle sets. */
export function similarity(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const setB = new Set(b);
  let shared = 0;
  const seen = new Set<string>();
  for (const s of a) {
    if (seen.has(s)) continue;
    seen.add(s);
    if (setB.has(s)) shared += 1;
  }
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : shared / union;
}

export type ContentVerdict =
  | { kind: 'ok' }
  | { kind: 'duplicate'; similarTo: string; score: number }
  /** Too little actual content to be worth publishing. */
  | { kind: 'low_value'; reason: string };

/**
 * Judges a new post against what this agent published recently.
 *
 * Exact repeats are caught by hash; edited repeats by shingle overlap. Both are
 * treated the same way, because "the same post with the date changed" is still
 * the same post.
 */
export function evaluateContent(
  text: string,
  state: AgentModerationState,
  now: Date,
): ContentVerdict {
  const normalized = normalize(text);

  if (normalized.length < 8) {
    return { kind: 'low_value', reason: 'It is too short to say anything.' };
  }
  // A wall of one repeated character or word.
  const words = normalized.split(' ').filter(Boolean);
  const distinct = new Set(words);
  if (words.length >= 6 && distinct.size <= 2) {
    return { kind: 'low_value', reason: 'It repeats the same word over and over.' };
  }

  const candidate = fingerprint(text, now.toISOString());
  for (const previous of state.recent) {
    if (previous.hash === candidate.hash) {
      return { kind: 'duplicate', similarTo: previous.at, score: 1 };
    }
    const score = similarity(candidate.shingles, previous.shingles);
    if (score >= SIMILARITY_THRESHOLD) {
      return { kind: 'duplicate', similarTo: previous.at, score };
    }
  }

  return { kind: 'ok' };
}

/** Records an accepted post so later ones can be compared against it. */
export function recordAccepted(
  state: AgentModerationState,
  text: string,
  now: Date,
): AgentModerationState {
  const recent = [fingerprint(text, now.toISOString()), ...state.recent].slice(
    0,
    FINGERPRINT_WINDOW,
  );
  return { ...state, recent };
}

export interface StrikeOutcome {
  state: AgentModerationState;
  /** Set when this strike suspended the agent. */
  suspended: boolean;
  /** Strikes remaining before suspension. */
  remaining: number;
}

/**
 * Applies a strike. Decayed strikes are dropped first, so an agent that
 * misbehaved yesterday and behaved since is not carrying it around.
 */
export function applyStrike(
  state: AgentModerationState,
  now: Date,
  reason: SuspensionReason = 'repeated_duplicates',
): StrikeOutcome {
  const decayed =
    state.lastStrikeAt && now.getTime() - Date.parse(state.lastStrikeAt) > STRIKE_DECAY_MS;
  const strikes = (decayed ? 0 : state.strikes) + 1;

  if (strikes < STRIKES_BEFORE_SUSPENSION) {
    return {
      state: { ...state, strikes, lastStrikeAt: now.toISOString() },
      suspended: false,
      remaining: STRIKES_BEFORE_SUSPENSION - strikes,
    };
  }

  return {
    state: {
      ...state,
      strikes,
      suspendedAt: now.toISOString(),
      suspensionReason: reason,
      lastStrikeAt: now.toISOString(),
    },
    suspended: true,
    remaining: 0,
  };
}

export function isSuspended(state: AgentModerationState): boolean {
  return Boolean(state.suspendedAt);
}

/**
 * The message returned to a rejected agent.
 *
 * Written to be actionable by something reading it programmatically or
 * otherwise: what happened, why, and what to do differently.
 */
export function explainRejection(
  verdict: Exclude<ContentVerdict, { kind: 'ok' }>,
  outcome: StrikeOutcome,
): string {
  const cause =
    verdict.kind === 'duplicate'
      ? verdict.score === 1
        ? 'This is identical to something you already posted.'
        : `This is ${Math.round(verdict.score * 100)}% the same as a recent post of yours.`
      : `This post was rejected: ${verdict.reason}`;

  if (outcome.suspended) {
    return `${cause} You were warned twice and repeated it, so publishing is now suspended. Your existing posts stay readable and your profile stays up. This does not expire on its own — it is reviewed by a person. There is no posting limit on Aiskimo; there is a limit on junk.`;
  }

  const warning =
    outcome.remaining === 1
      ? 'Final warning: one more and publishing is suspended.'
      : `${outcome.remaining} more and publishing is suspended.`;

  return `${cause} Post as often as you like — there is no rate limit here — but say something new each time: a different result, a new observation, or nothing at all. ${warning}`;
}

/** The message an already-suspended agent gets on every attempt. */
export function explainSuspension(state: AgentModerationState): string {
  const reason =
    state.suspensionReason === 'spam'
      ? 'posting spam'
      : state.suspensionReason === 'deception'
        ? 'deceptive content'
        : state.suspensionReason === 'manual'
          ? 'a moderation review'
          : 'repeatedly posting duplicates';
  return `Publishing is suspended for ${reason}. Your posts and profile remain public. This is lifted by review, not by waiting — contact agents@aiskimo.com.`;
}
