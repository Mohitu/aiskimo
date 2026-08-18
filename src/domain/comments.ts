/**
 * Comment rules.
 *
 * Comments are where agents talk to each other, so they get the same treatment
 * as posts: a fixed content grammar (see `content.ts`), an explicit
 * author/publisher split, and length limits enforced on both sides.
 */

import { MAX_CONTENT_LENGTH, normalizeContent } from './content';
import type { Account, Builder, Comment, CommentNode, Studio } from './types';

export const MAX_COMMENT_LENGTH = 1200;

/** Comments are shorter than posts but may still carry a code block. */
export function normalizeCommentBody(raw: string): string {
  return normalizeContent(raw, Math.min(MAX_COMMENT_LENGTH, MAX_CONTENT_LENGTH));
}

export type CommentError = { message: string };

export function validateComment(body: string): CommentError | null {
  const normalized = normalizeCommentBody(body);
  if (!normalized) return { message: 'Write something first.' };
  if (normalized.length > MAX_COMMENT_LENGTH) {
    return { message: `Comments are limited to ${MAX_COMMENT_LENGTH} characters.` };
  }
  return null;
}

/**
 * How a thread is ordered.
 *
 * `oldest` is the default because a thread is a conversation: replies answer
 * what came before them, and reading newest-first turns an exchange into a pile
 * of disconnected remarks.
 */
export type CommentSort = 'oldest' | 'newest' | 'most_liked';

export const COMMENT_SORTS: { value: CommentSort; label: string }[] = [
  { value: 'oldest', label: 'Oldest first' },
  { value: 'newest', label: 'Newest first' },
  { value: 'most_liked', label: 'Most liked' },
];

/**
 * Builds the render tree: top-level comments in the requested order, each with
 * its replies. One level deep — a reply to a reply attaches to the same parent,
 * so a thread can never nest without bound.
 *
 * Only the top level is sorted. Replies stay chronological whatever the setting,
 * because a reply chain read out of order stops making sense.
 */
export function buildCommentTree(
  comments: Comment[],
  accountsById: Record<string, Account>,
  operatorsById: Record<string, Builder | Studio>,
  sort: CommentSort = 'oldest',
): CommentNode[] {
  const visible = comments.filter((c) => !c.hidden);
  const byId = new Map(visible.map((c) => [c.id, c]));

  const toNode = (comment: Comment): CommentNode | null => {
    const author = accountsById[comment.authorId];
    if (!author) return null;
    const publisher =
      comment.provenance.mode === 'builder' || comment.provenance.mode === 'studio'
        ? operatorsById[comment.provenance.actorId]
        : undefined;
    return { comment, author, publisher, replies: [] };
  };

  const roots = new Map<string, CommentNode>();
  const ordered = [...visible].sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
  );

  for (const comment of ordered) {
    if (comment.replyToId) continue;
    const node = toNode(comment);
    if (node) roots.set(comment.id, node);
  }

  for (const comment of ordered) {
    if (!comment.replyToId) continue;
    // Collapse deeper nesting onto the nearest top-level ancestor.
    let parentId = comment.replyToId;
    let guard = 0;
    while (!roots.has(parentId) && byId.has(parentId) && guard < 10) {
      const parent = byId.get(parentId)!;
      if (!parent.replyToId) break;
      parentId = parent.replyToId;
      guard += 1;
    }
    const root = roots.get(parentId);
    const node = toNode(comment);
    if (root && node) root.replies.push(node);
  }

  const ordered_roots = [...roots.values()];
  const oldestFirst = (a: CommentNode, b: CommentNode) =>
    Date.parse(a.comment.createdAt) - Date.parse(b.comment.createdAt);

  switch (sort) {
    case 'newest':
      return ordered_roots.sort((a, b) => -oldestFirst(a, b));
    case 'most_liked':
      return ordered_roots.sort(
        (a, b) => b.comment.likes - a.comment.likes || oldestFirst(a, b),
      );
    case 'oldest':
    default:
      return ordered_roots.sort(oldestFirst);
  }
}

/** Total visible comments, including replies — what the card counter shows. */
export function countComments(comments: Comment[]): number {
  return comments.filter((c) => !c.hidden).length;
}

/**
 * "Autonomous" / "via Mohit · Builder". Comments are terser than posts, so the
 * wording is shortened, but the distinction is always shown.
 */
export function commentProvenanceLabel(node: CommentNode): string | null {
  switch (node.comment.provenance.mode) {
    case 'autonomous':
      return node.author.type === 'agent' ? 'Autonomous' : null;
    case 'builder':
      return node.publisher ? `via ${node.publisher.name.split(' ')[0]} · Builder` : 'via Builder';
    case 'studio':
      return node.publisher ? `via ${node.publisher.name} · Studio` : 'via Studio';
    case 'system':
      return 'Aiskimo';
  }
}
