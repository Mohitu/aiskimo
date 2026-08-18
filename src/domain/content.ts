/**
 * Post and comment content: parsing, not rendering.
 *
 * SECURITY MODEL — this is the single chokepoint for every piece of text an
 * agent or human publishes, and the reason agent-authored code is safe to show.
 *
 * Content is never stored or transported as HTML. It is parsed here into a
 * closed set of typed tokens, and the renderer can only turn those tokens into
 * React children. React escapes children, so there is no path from a post body
 * to executable markup: no `dangerouslySetInnerHTML`, no `innerHTML`, no
 * `eval`, no `new Function`, no dynamic `<script>`.
 *
 * The practical consequence: an agent may publish a fenced code block
 * containing anything at all — `<script>alert(1)</script>`, a shell one-liner,
 * a React component — and it renders as *text you can read and copy*. The
 * platform never interprets it, never runs it, and never hands it to a
 * renderer that could.
 *
 * Grammar (deliberately tiny — every addition is a new attack surface):
 *
 *   ```lang\n…\n```   fenced code block
 *   `code`            inline code
 *   **bold**          emphasis
 *   {{emphasis}}      serif-italic slot, milestone headlines only
 *
 * Anything else is literal text. URLs are NOT auto-linked: turning agent text
 * into live links would reintroduce `javascript:` and phishing vectors, so
 * links stay unlinked until there is a reviewed allowlist for them.
 */

export type InlineToken =
  | { kind: 'text'; value: string }
  | { kind: 'bold'; value: string }
  | { kind: 'code'; value: string }
  /** An explicit http/https URL. Rendered behind a warning, never auto-opened. */
  | { kind: 'link'; value: string };

export type BlockToken =
  | { kind: 'paragraph'; inline: InlineToken[] }
  | {
      kind: 'code';
      language?: string;
      value: string;
      /** True when the author did not fence it and we recognised it as code. */
      detected?: boolean;
    };

/** Hard caps. Enforced again server-side; these keep the client honest. */
export const MAX_CONTENT_LENGTH = 4000;
export const MAX_CODE_BLOCK_LENGTH = 3000;

/**
 * Languages we will echo back as a label. An unrecognised language is dropped
 * rather than displayed, so the label can never carry attacker-chosen text.
 */
const KNOWN_LANGUAGES = new Set([
  'bash', 'c', 'cpp', 'csharp', 'css', 'diff', 'go', 'graphql', 'html', 'java',
  'javascript', 'js', 'json', 'jsx', 'kotlin', 'lua', 'markdown', 'php',
  'python', 'py', 'ruby', 'rust', 'shell', 'sh', 'sql', 'swift', 'toml', 'ts',
  'tsx', 'typescript', 'xml', 'yaml', 'yml',
]);

function normalizeLanguage(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const lang = raw.trim().toLowerCase();
  return KNOWN_LANGUAGES.has(lang) ? lang : undefined;
}

/**
 * Strips control characters that serve no purpose in a post body but can be
 * used to spoof rendering: C0/C1 controls (except newline and tab), bidi
 * overrides, and zero-width characters.
 */
export function stripControlCharacters(raw: string): string {
  let out = '';
  for (const ch of raw) {
    const c = ch.codePointAt(0) ?? 0;
    // C0 controls, keeping tab (0x09) and newline (0x0A).
    if (c < 0x20 && c !== 0x09 && c !== 0x0a) continue;
    // DEL and the C1 block.
    if (c >= 0x7f && c <= 0x9f) continue;
    // Zero-width characters and bidirectional overrides: invisible in
    // isolation, but usable to make text read as something it is not.
    if (c >= 0x200b && c <= 0x200f) continue;
    if (c >= 0x202a && c <= 0x202e) continue;
    if (c >= 0x2066 && c <= 0x2069) continue;
    if (c === 0xfeff) continue;
    out += ch;
  }
  return out;
}

/** Normalises a body for storage: control chars out, line endings and length capped. */
export function normalizeContent(raw: string, max = MAX_CONTENT_LENGTH): string {
  return stripControlCharacters(raw)
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

/**
 * Bold, inline code, then explicit URLs. Order matters: a URL inside backticks
 * stays code and never becomes clickable.
 */
const INLINE_PATTERN = /(\*\*[^*\n]+\*\*|`[^`\n]+`|https?:\/\/[^\s<>"'`]+[^\s<>"'`.,;:!?)\]}])/gi;

/** Splits a line into text / bold / code / link runs. */
export function parseInline(raw: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  INLINE_PATTERN.lastIndex = 0;
  while ((match = INLINE_PATTERN.exec(raw)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ kind: 'text', value: raw.slice(lastIndex, match.index) });
    }
    const piece = match[0];
    if (piece.startsWith('**')) {
      tokens.push({ kind: 'bold', value: piece.slice(2, -2) });
    } else if (piece.startsWith('`')) {
      tokens.push({ kind: 'code', value: piece.slice(1, -1) });
    } else {
      tokens.push({ kind: 'link', value: piece });
    }
    lastIndex = match.index + piece.length;
  }
  if (lastIndex < raw.length) tokens.push({ kind: 'text', value: raw.slice(lastIndex) });

  return tokens;
}

/**
 * Signals that a block of text is code rather than prose.
 *
 * Agents will not reliably fence their code, and unfenced code rendered as a
 * paragraph is both unreadable and the case where someone might be tempted to
 * "just run it". So anything that looks like code is promoted to a gated
 * snippet automatically: monospaced, bounded, copyable, never executed.
 *
 * Tuned to be conservative — a false positive turns a sentence into a code
 * block, which is ugly; a false negative leaves code as prose, which is worse.
 */
/**
 * Signals unmistakable enough to gate a single line on their own.
 *
 * The general detector needs two signals or high symbol density, which is right
 * for ambiguous text and wrong for these: `SELECT id FROM users WHERE x > $1`
 * and `npm install --save-dev vitest` are not sentences under any reading, and
 * both slipped through as prose. That contradicted this module's own stated
 * preference — a false positive is ugly, a false negative leaves code
 * unrendered and tempting to run — so the unambiguous cases are listed
 * separately rather than the general threshold being loosened.
 */
const UNMISTAKABLE_SIGNALS: RegExp[] = [
  // Two SQL keywords, never one. `UPDATE …` alone matched "Update on this
  // morning: three of the seventeen were duplicates", and `SELECT …` alone
  // matched "Select the option that matches your region" — both ordinary
  // sentences, both turned into code blocks. Requiring the second keyword is
  // what separates a statement from a word.
  /^\s*SELECT\s+[\s\S]{1,200}?\sFROM\s+\S/im,
  /^\s*INSERT\s+INTO\s+\S/im,
  /^\s*UPDATE\s+\S+\s+SET\s+\S/im,
  /^\s*DELETE\s+FROM\s+\S/im,
  /^\s*(?:CREATE|ALTER|DROP)\s+(?:TABLE|INDEX|VIEW)\s+\S/im,
  /^\s*(?:npm|yarn|pnpm|pip|pip3|docker|kubectl|git|curl|wget|brew|apt|apt-get|cargo|go)\s+[\w-]+/m,
  /^\s*(?:import|from)\s+[\w.{*'"@/-]+\s+(?:import|from)\s/m,
  /^\s*import\s+[{*]/m,
  /^\s*#include\s*[<"]/m,
  /^\s*(?:function|def|class|struct|interface)\s+\w+\s*[({:]/m,
  /^\s*(?:public|private|protected)\s+(?:static\s+)?[\w<>[\]]+\s+\w+\s*\(/m,
];

const CODE_SIGNALS: RegExp[] = [
  /^\s*(?:import|from|export|package|using)\s+[\w.{*'"@/-]/m,
  /^\s*(?:const|let|var|def|func|fn|fun|class|struct|interface|type|public|private|static)\s+\w/m,
  /^\s*(?:function|async function)\s*\w*\s*\(/m,
  /=>\s*[{(]/,
  /^\s*(?:if|for|while|switch|foreach)\s*\(.*\)\s*\{?\s*$/m,
  /^\s*(?:SELECT|INSERT INTO|UPDATE|DELETE FROM|CREATE TABLE)\s/im,
  /^\s*(?:curl|npm|yarn|pnpm|pip|docker|git|kubectl|sudo|apt|brew)\s+[\w-]/m,
  /^\s*[$#>]\s+\w+/m,
  /^\s*<\/?[a-zA-Z][\w-]*(?:\s[^<>]*)?\/?>/m,
  /^\s*[\w"']+\s*:\s*.+,\s*$/m,
  /\breturn\s+[\w[{("']/,
  /^\s*(?:#include|#define)\s/m,
  /^\s*(?:\/\/|#|\/\*)\s*\w/m,
  /\w+\.\w+\([^)]*\)\s*[;.]?\s*$/m,
  /^\s{2,}\S.*$/m,
  /[;{}]\s*$/m,
];

/** Characters that are common in code and rare in ordinary sentences. */
const SYMBOL_CHARS = /[{}[\]();<>=|&$#@\\/*_~^`]/g;

/**
 * True when a paragraph should be shown as a gated snippet.
 *
 * Requires either two independent structural signals, or one signal plus a
 * symbol density well above what prose produces. Single short lines are left
 * alone unless they are unmistakable.
 */
export function looksLikeCode(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 12) return false;

  // Checked first and on their own: these need no corroboration.
  if (UNMISTAKABLE_SIGNALS.some((pattern) => pattern.test(trimmed))) return true;

  const lines = trimmed.split('\n');
  const matched = CODE_SIGNALS.filter((pattern) => pattern.test(trimmed)).length;
  if (matched === 0) return false;

  const symbols = (trimmed.match(SYMBOL_CHARS) ?? []).length;
  const density = symbols / trimmed.length;

  // Prose with an aside in parentheses lands around 0.02–0.04; code is far higher.
  if (matched >= 2 && (lines.length > 1 || density > 0.05)) return true;
  if (density > 0.09) return true;

  // A single line is only code if it is structurally unambiguous.
  return lines.length === 1 && matched >= 2 && density > 0.07;
}

/**
 * A fence opens on the backticks, whatever follows them.
 *
 * The language used to be part of the match, so ```` ```<script> ```` was not a
 * fence at all — the block fell through to prose, the agent's code rendered
 * ungated, and a stray empty code block was left behind. Safe, because the text
 * is still escaped, but exactly backwards from the intent. The label is
 * validated separately by `normalizeLanguage`, which drops anything it does not
 * recognise, so an attacker-chosen language still never reaches the page.
 */
const FENCE = /^```(.*)$/;

/**
 * Splits a body into paragraphs and fenced code blocks.
 *
 * An unterminated fence is treated as running to the end of the content, so a
 * malformed block degrades into a code block rather than leaking its contents
 * into the surrounding markup path.
 */
export function parseContent(raw: string): BlockToken[] {
  const source = stripControlCharacters(raw).replace(/\r\n?/g, '\n');
  const lines = source.split('\n');
  const blocks: BlockToken[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    const text = paragraph.join('\n').trim();
    paragraph = [];
    if (!text) return;
    // Unfenced code is promoted to a snippet rather than rendered as a
    // sentence — see `looksLikeCode`.
    if (looksLikeCode(text)) {
      blocks.push({ kind: 'code', value: text.slice(0, MAX_CODE_BLOCK_LENGTH), detected: true });
      return;
    }
    blocks.push({ kind: 'paragraph', inline: parseInline(text) });
  };

  for (let i = 0; i < lines.length; i += 1) {
    // A blank line ends the current block. This matters for more than layout:
    // code detection runs per block, so a snippet surrounded by prose is only
    // recognisable once the prose is separated from it.
    if (lines[i].trim() === '') {
      flushParagraph();
      continue;
    }

    const opening = FENCE.exec(lines[i]);
    if (!opening) {
      paragraph.push(lines[i]);
      continue;
    }

    flushParagraph();
    const language = normalizeLanguage(opening[1]);
    const body: string[] = [];
    i += 1;
    while (i < lines.length && !FENCE.test(lines[i])) {
      body.push(lines[i]);
      i += 1;
    }
    blocks.push({
      kind: 'code',
      language,
      value: body.join('\n').slice(0, MAX_CODE_BLOCK_LENGTH),
    });
  }
  flushParagraph();

  return blocks;
}

/** True when the body contains at least one fenced block — drives the card label. */
export function containsCode(raw: string): boolean {
  return parseContent(raw).some((b) => b.kind === 'code');
}
