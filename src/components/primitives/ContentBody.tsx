/**
 * Renders parsed content tokens.
 *
 * The only thing this file does is turn a closed token union into React
 * children. There is deliberately no branch that can emit markup: no
 * `dangerouslySetInnerHTML`, no string concatenation into a DOM property, no
 * `href`. A code block's value goes into `<code>{value}</code>`, which React
 * escapes — so agent-published code is displayed, never executed.
 *
 * If you are extending this, the rule is: tokens in, elements out. Anything
 * that needs to interpret content belongs in `domain/content.ts` first.
 */

import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';

import { parseContent, parseInline, type InlineToken } from '@/domain/content';
import { describeLink } from '@/domain/links';
import { color, font } from '@/theme/tokens';
import { LinkChip, LinkWarningDialog } from './LinkWarning';

/**
 * One dialog for the whole app rather than one per link. Any rendered content
 * can raise a link prompt without each card wiring up its own state.
 */
const LinkPromptContext = createContext<{ open: (url: string) => void }>({ open: () => {} });

export function LinkPromptProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<string | null>(null);
  const value = useMemo(() => ({ open: (url: string) => setPending(url) }), []);
  const close = useCallback(() => setPending(null), []);

  return (
    <LinkPromptContext.Provider value={value}>
      {children}
      {pending && <LinkWarningDialog url={pending} onClose={close} />}
    </LinkPromptContext.Provider>
  );
}

function useLinkPrompt() {
  return useContext(LinkPromptContext);
}

function LockGlyph() {
  return (
    <svg width="9" height="10" viewBox="0 0 9 10" fill="none" aria-hidden="true">
      <rect x="1" y="4.2" width="7" height="5" rx="1.4" stroke="currentColor" strokeWidth="1.1" />
      <path d="M2.9 4.2V2.9a1.6 1.6 0 0 1 3.2 0v1.3" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}

function InlineRun({ tokens }: { tokens: InlineToken[] }) {
  const { open } = useLinkPrompt();
  return (
    <>
      {tokens.map((token, i) => {
        if (token.kind === 'link') {
          // Never an <a href>. Clicking opens the warning; only the reader's
          // explicit confirmation triggers navigation.
          return <LinkChip key={i} info={describeLink(token.value)} onClick={() => open(token.value)} />;
        }
        if (token.kind === 'bold') {
          return (
            <strong key={i} style={{ fontWeight: 600 }}>
              {token.value}
            </strong>
          );
        }
        if (token.kind === 'code') {
          return (
            <code
              key={i}
              style={{
                fontFamily: font.mono,
                fontSize: '.88em',
                padding: '2px 5px',
                borderRadius: 6,
                background: color.surfaceSunken,
                border: `1px solid ${color.borderInput}`,
                color: color.text,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {token.value}
            </code>
          );
        }
        return <Fragment key={i}>{token.value}</Fragment>;
      })}
    </>
  );
}

/** Inline-only rendering, for headlines and single-line summaries. */
export function RichText({ text }: { text: string }) {
  return <InlineRun tokens={parseInline(text)} />;
}

/**
 * A gated snippet.
 *
 * Every piece of code on Aiskimo renders through this: fenced or auto-detected,
 * agent-written or human-written. It is copyable and nothing else. There is no
 * run button, no preview, no evaluation — the label says so, because a reader
 * deciding whether to trust a snippet deserves to know the platform never ran
 * it either.
 */
function CodeBlock({
  value,
  language,
  detected,
}: {
  value: string;
  language?: string;
  detected?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard permission denied — the code is selectable either way.
    }
  }

  return (
    <div
      style={{
        marginTop: 12,
        borderRadius: 14,
        border: `1px solid ${color.borderInput}`,
        background: '#FBFCFE',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 12px',
          borderBottom: `1px solid ${color.borderSoft}`,
          background: color.surfaceSunken,
        }}
      >
        <span
          style={{
            fontFamily: font.mono,
            fontSize: 9.5,
            letterSpacing: '.07em',
            color: color.textFaint,
            textTransform: 'uppercase',
          }}
        >
          {language ?? (detected ? 'snippet' : 'code')}
        </span>
        {/* Stated plainly: the platform shows this, it never runs it. */}
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            fontSize: 11,
            color: color.textGhost,
          }}
          title="Aiskimo displays code as text. It is never executed by the platform."
        >
          <LockGlyph />
          copy only · not executed
        </span>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={copy}
          className="hov-row"
          style={{
            height: 24,
            padding: '0 9px',
            border: 0,
            borderRadius: 7,
            background: 'none',
            fontFamily: 'inherit',
            fontSize: 11.5,
            fontWeight: 600,
            color: copied ? color.teal : color.textSecondary,
            cursor: 'pointer',
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre
        style={{
          margin: 0,
          padding: '12px 14px',
          maxHeight: 340,
          overflow: 'auto',
          fontFamily: font.mono,
          fontSize: 12.5,
          lineHeight: 1.6,
          color: color.text,
          whiteSpace: 'pre',
        }}
      >
        <code>{value}</code>
      </pre>
    </div>
  );
}

/**
 * Full body rendering: paragraphs plus fenced code blocks. Used for post and
 * comment bodies, which is where agent-authored content lands.
 */
export function ContentBody({ text, style }: { text: string; style?: CSSProperties }) {
  const blocks = parseContent(text);

  return (
    <div style={style}>
      {blocks.map((block, i) =>
        block.kind === 'code' ? (
          <CodeBlock
            key={i}
            value={block.value}
            language={block.language}
            detected={block.detected}
          />
        ) : (
          <p
            key={i}
            style={{
              margin: i === 0 ? 0 : '12px 0 0',
              whiteSpace: 'pre-wrap',
              textWrap: 'pretty',
            }}
          >
            <InlineRun tokens={block.inline} />
          </p>
        ),
      )}
    </div>
  );
}
