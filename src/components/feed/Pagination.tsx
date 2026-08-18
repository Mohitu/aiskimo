/**
 * Feed pagination.
 *
 * Explicit pages rather than infinite scroll: this is a network with a record,
 * and a reader should be able to get back to where they were. Page numbers
 * collapse around the current page so a long feed does not grow a long control.
 */

import { useViewport } from '@/hooks/useViewport';
import { color, font } from '@/theme/tokens';

/** Pages to show: first, last, and a window around the current one. */
function pageWindow(page: number, pageCount: number, span: number): (number | 'gap')[] {
  if (pageCount <= span) return Array.from({ length: pageCount }, (_, i) => i + 1);

  const pages = new Set<number>([1, pageCount, page]);
  for (let offset = 1; offset <= 1; offset += 1) {
    if (page - offset > 1) pages.add(page - offset);
    if (page + offset < pageCount) pages.add(page + offset);
  }

  const ordered = [...pages].sort((a, b) => a - b);
  const out: (number | 'gap')[] = [];
  let previous = 0;
  for (const p of ordered) {
    if (previous && p - previous > 1) out.push('gap');
    out.push(p);
    previous = p;
  }
  return out;
}

export function Pagination({
  page,
  pageCount,
  total,
  unit = 'posts',
  onChange,
}: {
  page: number;
  pageCount: number;
  total: number;
  /** What is being paged, for the summary line. */
  unit?: string;
  onChange: (page: number) => void;
}) {
  const { mobile } = useViewport();
  if (pageCount <= 1) return null;

  const pages = pageWindow(page, pageCount, mobile ? 5 : 7);

  return (
    <nav
      aria-label="Feed pages"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
        padding: '4px 2px 8px',
      }}
    >
      <PageButton disabled={page === 1} onClick={() => onChange(page - 1)}>
        ← Previous
      </PageButton>

      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {pages.map((entry, i) =>
          entry === 'gap' ? (
            <span
              key={`gap-${i}`}
              style={{ padding: '0 2px', color: color.textGhost, fontSize: 13 }}
            >
              …
            </span>
          ) : (
            <button
              key={entry}
              type="button"
              onClick={() => onChange(entry)}
              aria-current={entry === page ? 'page' : undefined}
              className={entry === page ? undefined : 'hov-ghost'}
              style={{
                minWidth: 34,
                height: 34,
                padding: '0 9px',
                borderRadius: 10,
                border: `1px solid ${entry === page ? 'transparent' : color.borderInput}`,
                background: entry === page ? color.ink : color.surface,
                color: entry === page ? '#fff' : color.textStrong,
                fontFamily: 'inherit',
                fontSize: 13.5,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all .16s ease',
              }}
            >
              {entry}
            </button>
          ),
        )}
      </div>

      <PageButton disabled={page === pageCount} onClick={() => onChange(page + 1)}>
        Next →
      </PageButton>

      <div style={{ flex: 1 }} />
      {!mobile && (
        <span
          style={{
            fontFamily: font.mono,
            fontSize: 10,
            letterSpacing: '.06em',
            color: color.textGhost,
            textTransform: 'uppercase',
          }}
        >
          {total} {unit} · page {page} of {pageCount}
        </span>
      )}
    </nav>
  );
}

function PageButton({
  children,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={disabled ? undefined : 'hov-ghost'}
      style={{
        height: 34,
        padding: '0 13px',
        borderRadius: 10,
        border: `1px solid ${color.borderInput}`,
        background: color.surface,
        fontFamily: 'inherit',
        fontSize: 13,
        fontWeight: 600,
        color: disabled ? color.textGhost : color.textStrong,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        whiteSpace: 'nowrap',
        transition: 'all .16s ease',
      }}
    >
      {children}
    </button>
  );
}
