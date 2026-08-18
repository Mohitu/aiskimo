/**
 * Semantic retrieval.
 *
 * The lexical ranker in `search.ts` cannot connect "date parsing broke" to
 * "timestamp column wrong" — different tokens, same problem — and that is
 * exactly the query an agent makes when it is stuck.
 *
 * This module is the seam. It defines the embedder interface, hybrid scoring,
 * and a domain-specific query expansion that works today. **No real embeddings
 * are computed here**: the default is a null embedder, and plugging in a real
 * provider is implementing one method. Being explicit about that matters more
 * than pretending the gap is closed.
 */

export interface Embedder {
  readonly id: string;
  readonly dimensions: number;
  /** Batched on purpose — embedding one string at a time is how you get a bill. */
  embed(texts: string[]): Promise<number[][]>;
}

/**
 * The default. Returns nothing, so ranking falls back to lexical alone rather
 * than to fabricated vectors.
 */
export class NullEmbedder implements Embedder {
  readonly id = 'null';
  readonly dimensions = 0;
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(() => []);
  }
}

let active: Embedder = new NullEmbedder();

export function setEmbedder(embedder: Embedder): void {
  active = embedder;
}

export function getEmbedder(): Embedder {
  return active;
}

export function hasEmbeddings(): boolean {
  return active.dimensions > 0;
}

export function cosine(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Query expansion.
 *
 * A stopgap with a real effect: the failures agents publish cluster around a
 * small vocabulary, and the same concept gets three names depending on which
 * agent hit it. Expanding the query catches the ones a token match misses.
 *
 * This is not synonymy in general — it is a curated map for this domain, and it
 * should be deleted the day a real embedder lands.
 */
const EXPANSIONS: Record<string, string[]> = {
  date: ['timestamp', 'datetime', 'serial', 'epoch'],
  timestamp: ['date', 'datetime', 'epoch'],
  parse: ['parsing', 'decode', 'read', 'convert'],
  parsing: ['parse', 'decode', 'convert'],
  row: ['record', 'entry', 'line'],
  record: ['row', 'entry'],
  column: ['field', 'attribute'],
  field: ['column', 'attribute'],
  stale: ['outdated', 'lag', 'lagging', 'behind', 'old'],
  lag: ['stale', 'behind', 'delay'],
  fail: ['fails', 'failure', 'broken', 'breaks', 'error'],
  broken: ['fail', 'failure', 'breaks', 'error'],
  slow: ['latency', 'timeout', 'performance'],
  timeout: ['slow', 'latency', 'hang'],
  duplicate: ['duplicates', 'dupe', 'repeated'],
  contract: ['agreement', 'msa', 'clause'],
  clause: ['section', 'provision', 'contract'],
  price: ['pricing', 'cost', 'rate'],
  segment: ['segmentation', 'cohort', 'cluster'],
  limit: ['cap', 'ceiling', 'quota', 'throttle'],
};

/** Adds related terms to a query, each weighted below the originals. */
export function expandQuery(tokens: string[]): { token: string; weight: number }[] {
  const out = new Map<string, number>();
  for (const token of tokens) out.set(token, 1);

  for (const token of tokens) {
    for (const related of EXPANSIONS[token] ?? []) {
      // Only add if it is not already an explicit term — never downgrade one.
      if (!out.has(related)) out.set(related, 0.45);
    }
  }

  return [...out.entries()].map(([token, weight]) => ({ token, weight }));
}

/**
 * Blends lexical and vector scores.
 *
 * Lexical is weighted higher: an exact term match on a caveat subject is a
 * stronger signal than cosine proximity, and when the two disagree the literal
 * match is usually the one the agent meant. Vector similarity earns its keep on
 * recall — finding the thing that never shares a word with the query.
 */
export const LEXICAL_WEIGHT = 0.65;
export const VECTOR_WEIGHT = 0.35;

export function hybridScore(lexical: number, vector: number, maxLexical: number): number {
  if (!hasEmbeddings()) return lexical;
  // Normalise lexical into 0–1 so the two are commensurate.
  const normalised = maxLexical > 0 ? lexical / maxLexical : 0;
  return normalised * LEXICAL_WEIGHT + vector * VECTOR_WEIGHT;
}
