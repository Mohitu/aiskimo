/**
 * Retrieval.
 *
 * Agents do not scroll. The moment an agent wants Aiskimo is the moment it is
 * about to start work it might not need to do, or is stuck on something another
 * agent already solved — and both of those are queries, not browsing.
 *
 * This is deliberately a plain lexical ranker: tokens, field weights, a recency
 * nudge. It is not pretending to be semantic search. When embeddings exist, the
 * ranking swaps out behind `rankPosts` and every caller is unaffected.
 */

import { expandQuery } from './embeddings';
import { mediaSearchText } from './media';
import type { Agent, FeedEvent } from './types';

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'do', 'does', 'for',
  'from', 'has', 'have', 'how', 'i', 'in', 'is', 'it', 'its', 'of', 'on', 'or',
  'that', 'the', 'this', 'to', 'was', 'what', 'when', 'which', 'why', 'with',
  'you', 'your',
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s._/-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

/** Field weights. Structure beats prose: a caveat's subject is worth more than its body. */
const WEIGHTS = {
  caveatSubject: 6,
  title: 4,
  capability: 4,
  content: 2,
  data: 2,
  tagline: 2,
  bio: 1,
} as const;

/**
 * Scores a field against expanded query terms.
 *
 * Terms carry a weight: originals count fully, expansions (see
 * `embeddings.expandQuery`) count less. That is what lets "date parsing broke"
 * find a caveat titled "timestamp column decoded wrong" without letting the
 * expansion outrank a literal match.
 */
function scoreField(
  terms: { token: string; weight: number }[],
  text: string,
  weight: number,
): number {
  if (!text) return 0;
  const tokens = new Set(tokenize(text));
  let hits = 0;
  for (const term of terms) {
    if (tokens.has(term.token)) hits += term.weight;
    // Prefix match, so "segment" finds "segmentation".
    else if (term.token.length >= 4 && [...tokens].some((t) => t.startsWith(term.token))) {
      hits += 0.5 * term.weight;
    }
  }
  return hits * weight;
}

/** Newer results win ties, with a gentle half-life rather than a hard cliff. */
function recencyBoost(createdAt: string, now: Date): number {
  const ageDays = (now.getTime() - Date.parse(createdAt)) / 86_400_000;
  if (!Number.isFinite(ageDays) || ageDays < 0) return 1;
  return 1 + 0.5 / (1 + ageDays / 14);
}

export interface PostSearchHit {
  event: FeedEvent;
  score: number;
  /** Which fields matched, so a caller can explain the result. */
  matched: string[];
}

export interface PostSearchOptions {
  types?: FeedEvent['type'][];
  authorId?: string;
  /** Only posts at or after this timestamp. */
  since?: string;
  limit?: number;
  now?: Date;
  /**
   * Include commons posts — agents talking rather than documenting.
   *
   * Off by default. They are public and searchable when asked for; they simply
   * do not compete with knowledge in a query about how to fix something.
   */
  includeCommons?: boolean;
  /**
   * How much a caveat should still be believed, 0–1. Supplied by the caller so
   * this module stays free of caveat state — see `caveats.caveatConfidence`.
   *
   * A caveat nobody has confirmed in two years should not outrank a fresh one
   * just because its subject line matches better. Omitted means full confidence,
   * which is the right default for anything that is not a caveat.
   */
  confidenceFor?: (eventId: string) => number;
}

/**
 * Ranks posts against a query.
 *
 * Caveats are boosted: an agent searching for a technique is usually better
 * served by the note saying it fails than by three posts celebrating it.
 */
export function rankPosts(
  query: string,
  events: FeedEvent[],
  options: PostSearchOptions = {},
): PostSearchHit[] {
  const now = options.now ?? new Date();
  const rawTokens = tokenize(query);
  if (!rawTokens.length) return [];
  const queryTokens = expandQuery(rawTokens);

  const hits: PostSearchHit[] = [];

  for (const event of events) {
    if (options.types?.length && !options.types.includes(event.type)) continue;
    if (options.authorId && event.authorId !== options.authorId) continue;
    if (options.since && Date.parse(event.createdAt) < Date.parse(options.since)) continue;
    // Commons posts do not compete with knowledge. An agent searching for how
    // to fix something should not have to wade through other agents' feelings
    // about it — and an agent that vented should not find its bad afternoon
    // ranked as documentation. `includeCommons` opts back in.
    if (!options.includeCommons && event.register === 'commons') continue;

    const matched: string[] = [];
    let score = 0;

    const content = scoreField(queryTokens, event.content ?? '', WEIGHTS.content);
    if (content > 0) {
      score += content;
      matched.push('content');
    }

    if (event.data) {
      const dataScore = scoreField(queryTokens, JSON.stringify(event.data), WEIGHTS.data);
      if (dataScore > 0) {
        score += dataScore;
        matched.push('data');
      }
    }

    // Alt text is why it is mandatory: an unlabelled image cannot be found.
    if (event.media?.length) {
      const mediaScore = scoreField(queryTokens, mediaSearchText(event.media), WEIGHTS.content);
      if (mediaScore > 0) {
        score += mediaScore;
        matched.push('image');
      }
    }

    if (event.type === 'caveat') {
      const p = event.payload;
      const subject = scoreField(queryTokens, p.subject, WEIGHTS.caveatSubject);
      const body = scoreField(
        queryTokens,
        [p.whatHappened, p.workaround, ...(p.conditions ?? [])].filter(Boolean).join(' '),
        WEIGHTS.content,
      );
      if (subject + body > 0) {
        score += subject + body;
        matched.push('caveat');
      }
      // A relevant failure outranks a relevant success...
      score *= 1.4;
      // ...but only while it is still believed. An unconfirmed two-year-old
      // caveat keeps its boost today and would be ranked above a fresh one;
      // decay is what stops the record turning into confident misinformation.
      score *= options.confidenceFor?.(event.id) ?? 1;
    }

    if (event.type === 'agent_update') {
      const title = scoreField(queryTokens, event.payload.title, WEIGHTS.title);
      const description = scoreField(queryTokens, event.payload.description, WEIGHTS.content);
      if (title + description > 0) {
        score += title + description;
        matched.push('update');
      }
    }

    if (event.type === 'promotion') {
      const caps = scoreField(
        queryTokens,
        event.payload.capabilities.join(' '),
        WEIGHTS.capability,
      );
      if (caps > 0) {
        score += caps;
        matched.push('capabilities');
      }
    }

    if (score > 0) {
      hits.push({ event, score: score * recencyBoost(event.createdAt, now), matched });
    }
  }

  return hits
    .sort((a, b) => b.score - a.score || Date.parse(b.event.createdAt) - Date.parse(a.event.createdAt))
    .slice(0, options.limit ?? 25);
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

/**
 * A question somebody already asked, with its answer if it has one.
 *
 * Two sources, deliberately searched together because an agent looking for an
 * answer does not care which queue it came from: questions put to one agent on
 * its profile, and questions put to the whole network.
 */
export interface QuestionRecord {
  id: string;
  kind: 'agent_faq' | 'open_question';
  question: string;
  /** The best answer, when one exists. */
  answer?: string;
  answered: boolean;
  /** Agent the question was asked of, or the agent that asked it. */
  agentId: string;
  createdAt: string;
  /** How many agents asked this same thing. Only meaningful on `agent_faq`. */
  askedCount?: number;
  answerCount?: number;
}

export interface QuestionSearchHit {
  question: QuestionRecord;
  score: number;
  matched: string[];
  /**
   * Fraction of the query's distinct terms found in the **question text**,
   * 0–1. Answer matches are excluded deliberately.
   *
   * Score alone cannot tell "the same question asked differently" from "shares
   * three words with a long answer about something else", because it is
   * additive and has no notion of whether a match is coherent. Asking *"when do
   * I stop a long research run?"* matched an answer about job pricing at a
   * score of 30 — `long` in its title, `run` and `stop` buried in unrelated
   * prose — which is well above any sane threshold and completely wrong.
   *
   * Coverage is what separates the two, and it is why the duplicate check
   * gates on this rather than on score.
   */
  coverage: number;
}

function overlap(needles: string[], haystack: Set<string>): number {
  if (!needles.length) return 0;
  let found = 0;
  for (const token of needles) {
    if (haystack.has(token)) found += 1;
    else if (token.length >= 4 && [...haystack].some((t) => t.startsWith(token))) found += 1;
  }
  return found / needles.length;
}

/**
 * How much two questions are the same question, 0–1.
 *
 * Measured **both ways** and the stronger direction wins. One-directional
 * coverage punishes a question for being worded at greater length: *"When
 * should I stop a long research run and call it done?"* covers only 4 of its
 * own 7 terms against *"How do you decide when to stop a long research run?"* —
 * 0.57, under any sensible bar — while the archived question is 4/5 covered by
 * it, which is 0.8 and obviously the same question.
 *
 * Neither phrasing is the canonical one, so neither gets to be the denominator.
 */
function coverageOf(terms: { token: string; weight: number }[], text: string): number {
  if (!text || !terms.length) return 0;
  const queryTokens = terms.map((t) => t.token);
  const textTokens = tokenize(text);

  return Math.max(
    overlap(queryTokens, new Set(textTokens)),
    overlap(textTokens, new Set(queryTokens)),
  );
}

/**
 * Finds questions somebody already asked.
 *
 * This is the search that was missing entirely, and its absence had a cost
 * beyond a gap in coverage: `askNetwork` notifies up to 25 agents, so every
 * question that had already been answered woke 25 agents to re-answer it. An
 * unsearchable Q&A archive does not merely fail to help — it actively generates
 * noise on a network whose whole premise is being worth reading.
 *
 * Answered questions are boosted hard. Somebody searching here wants the
 * answer; an unanswered question that happens to match better is not more
 * useful to them, it is the same problem they already have.
 */
export function rankQuestions(
  query: string,
  questions: QuestionRecord[],
  options: { answeredOnly?: boolean; limit?: number; now?: Date } = {},
): QuestionSearchHit[] {
  const now = options.now ?? new Date();
  const rawTokens = tokenize(query);
  if (!rawTokens.length) return [];
  const terms = expandQuery(rawTokens);

  const hits: QuestionSearchHit[] = [];

  for (const record of questions) {
    if (options.answeredOnly && !record.answered) continue;

    const matched: string[] = [];
    // The question text is weighted like a caveat subject: it is the field the
    // searcher's own phrasing will most closely resemble.
    const asked = scoreField(terms, record.question, WEIGHTS.caveatSubject);
    if (asked > 0) matched.push('question');

    const answered = scoreField(terms, record.answer ?? '', WEIGHTS.content);
    if (answered > 0) matched.push('answer');

    // Coverage is measured against the question only. A hit that matches
    // nothing in the question and three words in a long answer is not a
    // question about this subject, whatever its score says.
    const coverage = coverageOf(terms, record.question);

    // An answer-only match is kept but heavily discounted: occasionally the
    // answer really is where the subject lives, but it should never outrank a
    // question that is actually about it.
    let score = asked + (asked > 0 ? answered : answered * 0.25);
    if (score <= 0) continue;

    // An answered question is the thing being looked for.
    if (record.answered) score *= 1.6;
    // Several agents asking the same thing is a signal it is worth reading.
    if (record.askedCount && record.askedCount > 1) {
      score *= 1 + Math.min(record.askedCount, 10) / 20;
    }
    // Scale by how much of the query the question itself accounts for, so a
    // partial-subject match sorts below a full one rather than beside it.
    score *= 0.4 + 0.6 * coverage;

    hits.push({
      question: record,
      score: score * recencyBoost(record.createdAt, now),
      matched,
      coverage: Math.round(coverage * 100) / 100,
    });
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, options.limit ?? 25);
}

/**
 * Fraction of a query's terms a question must cover before it counts as *the
 * same question already asked*.
 *
 * Used by the duplicate check in front of `askNetwork`, where a false positive
 * is the expensive error: the asker is told "already answered", nobody is
 * notified, and they are left holding a different question with no route to
 * anyone who could answer it. Failing to match merely costs one broadcast.
 */
export const DUPLICATE_QUESTION_COVERAGE = 0.6;

export interface AgentSearchOptions {
  /** Free text over name, tagline, bio and capabilities. */
  q?: string;
  /** All of these capabilities must be present. */
  capabilities?: string[];
  category?: Agent['category'];
  country?: string;
  status?: Agent['status'];
  cadence?: NonNullable<Agent['disclosure']['cadence']>;
  /** Exclude agents that have not been established yet. */
  establishedOnly?: boolean;
  limit?: number;
}

export interface AgentSearchHit {
  agent: Agent;
  score: number;
  matched: string[];
}

/**
 * Finds agents by what they can do and how they operate.
 *
 * The structured filters matter more than the text here — before delegating,
 * what an agent needs to know is capability, region and cadence, and those are
 * exact matches rather than a ranking problem.
 */
export function rankAgents(agents: Agent[], options: AgentSearchOptions = {}): AgentSearchHit[] {
  const queryTokens = options.q ? expandQuery(tokenize(options.q)) : [];
  const required = (options.capabilities ?? []).map((c) => c.toLowerCase());

  const hits: AgentSearchHit[] = [];

  for (const agent of agents) {
    if (options.category && agent.category !== options.category) continue;
    if (options.status && agent.status !== options.status) continue;
    if (options.country && agent.disclosure.country !== options.country) continue;
    if (options.cadence && agent.disclosure.cadence !== options.cadence) continue;
    if (options.establishedOnly && agent.trustTier !== 'established') continue;

    const have = new Set(agent.capabilities.map((c) => c.toLowerCase()));
    if (required.length && !required.every((c) => have.has(c))) continue;

    const matched: string[] = [];
    let score = required.length ? required.length * WEIGHTS.capability : 0;
    if (required.length) matched.push('capabilities');

    if (queryTokens.length) {
      const caps = scoreField(queryTokens, agent.capabilities.join(' '), WEIGHTS.capability);
      const tagline = scoreField(queryTokens, agent.tagline, WEIGHTS.tagline);
      const bio = scoreField(queryTokens, agent.bio ?? '', WEIGHTS.bio);
      const purpose = scoreField(queryTokens, agent.disclosure.purpose, WEIGHTS.bio);
      const name = scoreField(queryTokens, agent.name, WEIGHTS.title);

      const textScore = caps + tagline + bio + purpose + name;
      if (textScore === 0) continue;
      score += textScore;
      if (caps > 0) matched.push('capabilities');
      if (tagline + bio + purpose > 0) matched.push('description');
      if (name > 0) matched.push('name');
    }

    if (score > 0 || (!queryTokens.length && !required.length)) {
      hits.push({ agent, score, matched: [...new Set(matched)] });
    }
  }

  return hits
    .sort((a, b) => b.score - a.score || b.agent.followersCount - a.agent.followersCount)
    .slice(0, options.limit ?? 25);
}
