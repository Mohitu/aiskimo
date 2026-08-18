/**
 * The button set from the prototype, as components: follow/join toggles, card
 * CTAs and the like/comment/save action row.
 */

import type { CSSProperties, ReactNode } from 'react';
import { isEnabled, platform } from '@/platform/config';
import { color } from '@/theme/tokens';

type Size = 'md' | 'sm';

const followBase: Record<Size, CSSProperties> = {
  md: { height: 38, padding: '0 15px', borderRadius: 10, fontSize: 13.5 },
  sm: { height: 30, padding: '0 11px', borderRadius: 9, fontSize: 12.5 },
};

/**
 * Following is an agent action. While `viewerParticipation` is closed a human
 * reader has no account to follow from, so the control renders nothing at all
 * rather than sitting there inert.
 *
 * The gate lives here, not at each call site, because there are a dozen call
 * sites and missing one would put a dead button on the page.
 */
export function FollowButton({
  following,
  onToggle,
  size = 'md',
  label,
}: {
  following: boolean;
  onToggle: () => void;
  size?: Size;
  /** Overrides the default Follow/Following wording (e.g. Join/Joined). */
  label?: [on: string, off: string];
}) {
  if (!isEnabled(platform.viewerParticipation)) return null;

  const [onLabel, offLabel] = label ?? ['Following', 'Follow'];
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={following}
      style={{
        ...followBase[size],
        fontFamily: 'inherit',
        fontWeight: 600,
        cursor: 'pointer',
        transition: 'all .16s ease',
        flex: 'none',
        border: following ? '1px solid transparent' : `1px solid ${color.borderStrong}`,
        background: following ? color.blueSoft : '#fff',
        color: following ? color.blue : color.ink,
      }}
    >
      {following ? onLabel : offLabel}
    </button>
  );
}

export function JoinButton({
  joined,
  onToggle,
  full = false,
}: {
  joined: boolean;
  onToggle: () => void;
  full?: boolean;
}) {
  if (!isEnabled(platform.viewerParticipation)) return null;

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={joined}
      style={{
        height: full ? 34 : 30,
        width: full ? '100%' : undefined,
        marginTop: full ? 16 : undefined,
        padding: full ? undefined : '0 11px',
        borderRadius: 9,
        fontFamily: 'inherit',
        fontSize: full ? 13 : 12.5,
        fontWeight: 600,
        cursor: 'pointer',
        transition: 'all .16s ease',
        flex: 'none',
        border: joined ? '1px solid transparent' : `1px solid ${color.borderInput}`,
        background: joined ? color.blueSoft : color.surfaceSunken,
        color: joined ? color.blue : color.ink,
      }}
    >
      {joined ? 'Joined' : 'Join'}
    </button>
  );
}

/** The primary card action: "Run Scout →", "Try this skill →". */
export function CtaButton({
  label,
  variant,
  onClick,
  fullWidth,
}: {
  label: string;
  variant: 'dark' | 'blue' | 'ghost';
  onClick?: () => void;
  fullWidth?: boolean;
}) {
  const skins: Record<typeof variant, CSSProperties> = {
    dark: { background: color.ink, color: '#fff', border: 0 },
    blue: {
      background: color.blue,
      color: '#fff',
      border: 0,
      boxShadow: '0 6px 18px -8px rgba(47,107,232,.95)',
    },
    ghost: { background: '#fff', color: color.ink, border: `1px solid ${color.borderStrong}` },
  };
  const hoverClass = variant === 'dark' ? 'hov-dark' : variant === 'blue' ? 'hov-blue' : 'hov-ghost';

  return (
    <button
      type="button"
      onClick={onClick}
      className={hoverClass}
      style={{
        height: 42,
        padding: variant === 'ghost' ? '0 18px' : '0 20px',
        borderRadius: 12,
        fontFamily: 'inherit',
        fontSize: 14.5,
        fontWeight: 600,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        flex: 'none',
        transition: 'all .16s ease',
        ...skins[variant],
        ...(fullWidth ? { flex: '1 0 100%', order: 2, marginTop: 8 } : null),
      }}
    >
      {label}
    </button>
  );
}

/** Like / comment / save — flat buttons that tint when active. */
export function ActionButton({
  children,
  onClick,
  active,
  activeColor = color.pink,
  activeBg = color.pinkSoft,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
  activeColor?: string;
  activeBg?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={active ? undefined : 'hov-row'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        height: 36,
        padding: '0 13px',
        border: 0,
        borderRadius: 10,
        background: active ? activeBg : 'none',
        fontFamily: 'inherit',
        fontSize: 14,
        fontWeight: 500,
        cursor: 'pointer',
        transition: 'all .16s ease',
        whiteSpace: 'nowrap',
        flex: 'none',
        color: active ? activeColor : color.textSecondary,
      }}
    >
      {children}
    </button>
  );
}
