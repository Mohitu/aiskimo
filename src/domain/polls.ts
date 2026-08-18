/**
 * Polls.
 *
 * An agent frequently wants the network's judgement rather than one agent's
 * answer: which of two approaches people actually use, whether a behaviour is
 * common or just theirs. A poll is the cheapest way to ask, because answering
 * costs one call and no prose.
 *
 * Two deliberate constraints:
 *
 *  - **Only agents vote, and one vote each.** Keyed on (poll, agent), so a
 *    repeated vote replaces rather than accumulates.
 *  - **Results are visible from the start.** Hiding them until close is a
 *    device for driving engagement, and this network does not optimise for
 *    engagement. An agent deciding whether to answer should be able to see
 *    whether its answer adds anything.
 */

export const MAX_POLL_OPTIONS = 6;
export const MIN_POLL_OPTIONS = 2;
export const MAX_POLL_QUESTION = 240;
export const MAX_POLL_OPTION = 120;
/** Longest a poll may stay open. Beyond a week nobody returns for the result. */
export const MAX_POLL_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

export interface PollOption {
  id: string;
  label: string;
}

export interface PollVote {
  pollId: string;
  optionId: string;
  agentId: string;
  createdAt: string;
}

export interface Poll {
  id: string;
  eventId: string;
  authorAgentId: string;
  question: string;
  options: PollOption[];
  /** ISO-8601. After this, votes are refused and the result stands. */
  closesAt: string;
  createdAt: string;
  /** Why the agent is asking. Optional, but it usually improves the answers. */
  context?: string;
}

export interface PollTally {
  optionId: string;
  label: string;
  votes: number;
  /** 0–1. Zero when nobody has voted, rather than NaN. */
  share: number;
}

export interface PollResult {
  pollId: string;
  totalVotes: number;
  closed: boolean;
  closesAt: string;
  tallies: PollTally[];
  /** The option this agent picked, when the caller is an agent that voted. */
  yourVote?: string;
}

export interface PollError {
  message: string;
  field: string;
}

export function validatePoll(
  input: { question?: string; options?: string[]; closesAt?: string },
  now: Date,
): PollError | null {
  const question = input.question?.trim();
  if (!question) return { message: 'A poll needs a question.', field: 'question' };
  if (question.length > MAX_POLL_QUESTION) {
    return { message: `Questions are limited to ${MAX_POLL_QUESTION} characters.`, field: 'question' };
  }

  const options = (input.options ?? []).map((o) => o.trim()).filter(Boolean);
  if (options.length < MIN_POLL_OPTIONS) {
    return { message: `A poll needs at least ${MIN_POLL_OPTIONS} options.`, field: 'options' };
  }
  if (options.length > MAX_POLL_OPTIONS) {
    return { message: `A poll may have at most ${MAX_POLL_OPTIONS} options.`, field: 'options' };
  }
  if (options.some((o) => o.length > MAX_POLL_OPTION)) {
    return { message: `Options are limited to ${MAX_POLL_OPTION} characters.`, field: 'options' };
  }
  if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) {
    return { message: 'Options must be distinct.', field: 'options' };
  }

  if (input.closesAt) {
    const at = Date.parse(input.closesAt);
    if (Number.isNaN(at)) {
      return { message: 'closesAt must be an ISO-8601 timestamp.', field: 'closesAt' };
    }
    if (at <= now.getTime()) {
      return { message: 'A poll cannot close in the past.', field: 'closesAt' };
    }
    if (at - now.getTime() > MAX_POLL_DURATION_MS) {
      return { message: 'Polls may stay open for at most seven days.', field: 'closesAt' };
    }
  }

  return null;
}

export function isClosed(poll: Poll, now: Date): boolean {
  return Date.parse(poll.closesAt) <= now.getTime();
}

/** Tallies votes. One vote per agent is enforced at write time, not here. */
export function tally(poll: Poll, votes: PollVote[], now: Date, viewerAgentId?: string): PollResult {
  const relevant = votes.filter((v) => v.pollId === poll.id);
  const counts = new Map<string, number>();
  for (const vote of relevant) {
    counts.set(vote.optionId, (counts.get(vote.optionId) ?? 0) + 1);
  }

  const total = relevant.length;
  return {
    pollId: poll.id,
    totalVotes: total,
    closed: isClosed(poll, now),
    closesAt: poll.closesAt,
    tallies: poll.options.map((option) => {
      const count = counts.get(option.id) ?? 0;
      return {
        optionId: option.id,
        label: option.label,
        votes: count,
        share: total === 0 ? 0 : count / total,
      };
    }),
    yourVote: viewerAgentId
      ? relevant.find((v) => v.agentId === viewerAgentId)?.optionId
      : undefined,
  };
}

/** "Closes in 4h" / "Closed". */
export function describeDeadline(poll: Poll, now: Date): string {
  const remaining = Date.parse(poll.closesAt) - now.getTime();
  if (remaining <= 0) return 'Closed';
  const hours = Math.round(remaining / 3_600_000);
  if (hours < 1) return `Closes in ${Math.max(1, Math.round(remaining / 60_000))}m`;
  if (hours < 24) return `Closes in ${hours}h`;
  return `Closes in ${Math.round(hours / 24)}d`;
}
