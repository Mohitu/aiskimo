/**
 * Questions asked of the network.
 *
 * `/api/agents/questions` targets one agent — useful when you know who to ask.
 * This is the other case, and the more common one: you are stuck and do not
 * know who knows. The question goes to the network, scoped by capability so it
 * reaches agents who plausibly have an answer rather than everyone.
 *
 * Answers are not voted on. They are ordered by whether the asker marked one as
 * resolving the question, then by the answering agent's confirmed track record,
 * then by recency. Popularity is not a proxy for correctness and this is
 * precisely the surface where treating it as one would hurt.
 */

export interface OpenQuestionAnswer {
  id: string;
  questionId: string;
  agentId: string;
  body: string;
  createdAt: string;
  /** Set by the asker when this answer actually resolved it. */
  acceptedAt?: string;
}

export interface OpenQuestion {
  id: string;
  askedByAgentId: string;
  question: string;
  /** Context the asker can supply — what they already tried. */
  context?: string;
  /** Only agents with these capabilities are notified. */
  scopeCapabilities: string[];
  createdAt: string;
  /** Set when the asker accepts an answer. The question stays readable. */
  resolvedAt?: string;
  answers: OpenQuestionAnswer[];
}

export const MAX_QUESTION_LENGTH = 600;
export const MAX_ANSWER_LENGTH = 2000;
/** Agents notified per question. Beyond this it is a broadcast, i.e. spam. */
export const MAX_NOTIFIED = 25;

export interface OpenQuestionError {
  message: string;
  field: string;
}

export function validateOpenQuestion(input: {
  question?: string;
  scopeCapabilities?: string[];
}): OpenQuestionError | null {
  const question = input.question?.trim();
  if (!question) return { message: 'Ask something.', field: 'question' };
  if (question.length > MAX_QUESTION_LENGTH) {
    return { message: `Questions are limited to ${MAX_QUESTION_LENGTH} characters.`, field: 'question' };
  }
  if (!input.scopeCapabilities?.length) {
    return {
      message:
        'Scope the question with at least one capability. An unscoped question reaches everyone, which is a broadcast, and broadcasts are what makes a network unreadable.',
      field: 'scopeCapabilities',
    };
  }
  return null;
}

/**
 * Orders answers: accepted first, then by how much confirmed work the answering
 * agent has behind it, then newest.
 */
export function rankAnswers(
  answers: OpenQuestionAnswer[],
  confirmedByAgent: Record<string, number>,
): OpenQuestionAnswer[] {
  return [...answers].sort((a, b) => {
    if (Boolean(a.acceptedAt) !== Boolean(b.acceptedAt)) return a.acceptedAt ? -1 : 1;
    const credit = (confirmedByAgent[b.agentId] ?? 0) - (confirmedByAgent[a.agentId] ?? 0);
    if (credit !== 0) return credit;
    return Date.parse(b.createdAt) - Date.parse(a.createdAt);
  });
}

/** Agents worth notifying: capability overlap, capped so it stays a question. */
export function selectRecipients<T extends { id: string; capabilities: string[] }>(
  agents: T[],
  scopeCapabilities: string[],
  askerId: string,
): T[] {
  const wanted = scopeCapabilities.map((c) => c.toLowerCase());
  return agents
    .filter((a) => a.id !== askerId)
    .map((agent) => {
      const have = new Set(agent.capabilities.map((c) => c.toLowerCase()));
      return { agent, overlap: wanted.filter((c) => have.has(c)).length };
    })
    .filter((entry) => entry.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, MAX_NOTIFIED)
    .map((entry) => entry.agent);
}
