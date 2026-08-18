/**
 * Centred dialog shell, styled to match the header menu's card treatment.
 *
 * Rendered through a portal to `document.body`, which is not cosmetic: any
 * ancestor carrying a `transform`, `filter` or `backdrop-filter` becomes the
 * containing block for `position: fixed`, and `.feed-card` carries a transform
 * for its hover lift. A dialog opened from inside a card would otherwise be
 * pinned to that card — centred over the post rather than the screen, and
 * clipped by it. The portal makes where a dialog is *opened from* irrelevant to
 * where it *appears*.
 */

import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { color, shadow } from '@/theme/tokens';

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  width = 460,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);

    // Stop the feed scrolling underneath an open dialog. Restored on close
    // rather than assumed empty, so nested opens do not strand the page.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 300,
        background: 'rgba(12,18,25,.38)',
        backdropFilter: 'blur(4px)',
        display: 'grid',
        placeItems: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width,
          maxWidth: '100%',
          maxHeight: '86vh',
          overflowY: 'auto',
          background: color.surface,
          border: `1px solid ${color.borderCard}`,
          borderRadius: 22,
          boxShadow: shadow.menu,
          padding: 24,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: 21, fontWeight: 600, letterSpacing: '-.028em' }}>
              {title}
            </h2>
            {subtitle && (
              <p
                style={{
                  margin: '8px 0 0',
                  fontSize: 14,
                  lineHeight: 1.5,
                  color: color.textSecondary,
                }}
              >
                {subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="hov-row"
            style={{
              width: 32,
              height: 32,
              border: 0,
              borderRadius: 10,
              background: 'none',
              cursor: 'pointer',
              color: color.textDim,
              fontSize: 18,
              lineHeight: 1,
              flex: 'none',
            }}
          >
            ×
          </button>
        </div>
        <div style={{ marginTop: 20 }}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/** Shared text input styling for the dialogs. */
export function Field({
  label,
  hint,
  style,
  ...props
}: {
  label: string;
  hint?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label style={{ display: 'block', marginBottom: 14 }}>
      <span
        style={{
          display: 'block',
          fontSize: 12.5,
          fontWeight: 600,
          color: color.textStrong,
          marginBottom: 6,
        }}
      >
        {label}
      </span>
      <input
        {...props}
        style={{
          width: '100%',
          height: 42,
          padding: '0 13px',
          border: `1px solid ${color.borderInput}`,
          borderRadius: 11,
          background: color.surfaceSunken,
          fontFamily: 'inherit',
          fontSize: 15,
          color: color.ink,
          outline: 'none',
          ...style,
        }}
      />
      {hint && (
        <span style={{ display: 'block', fontSize: 12, color: color.textDim, marginTop: 6 }}>
          {hint}
        </span>
      )}
    </label>
  );
}
