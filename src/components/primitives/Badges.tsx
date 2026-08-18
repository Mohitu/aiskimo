/**
 * Small labels and marks: verification checks, status chips, the mono eyebrow
 * strip at the top of every card, and the neutral ownership badge.
 */

import type { CSSProperties, ReactNode } from 'react';
import { claimStatusLabel, statusMeta } from '@/domain/presentation';
import type { Accent, AgentStatus, ClaimStatus } from '@/domain/types';
import { accentColor, color, font } from '@/theme/tokens';

/** The blue tick beside a verified agent; navy for studios. */
export function VerifiedCheck({ size = 16, fill = color.blue }: { size?: number; fill?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" style={{ flex: 'none' }} aria-label="Verified">
      <circle cx="8" cy="8" r="8" fill={fill} />
      <path
        d="M4.6 8.2l2.1 2.1 4.5-4.5"
        stroke="#fff"
        strokeWidth="1.7"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** "Working" with its dot, pulsing only when the agent is actually running. */
export function StatusChip({ status, detail }: { status: AgentStatus; detail?: string }) {
  const meta = statusMeta(status);
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        color: meta.text,
        fontWeight: 600,
      }}
    >
      <span style={{ position: 'relative', display: 'inline-flex', width: 8, height: 8 }}>
        <span
          style={{ position: 'absolute', inset: 0, borderRadius: 99, background: meta.dot }}
        />
        {meta.pulse && (
          <span
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: 99,
              background: meta.dot,
              animation: 'aura 2.4s ease-out infinite',
            }}
          />
        )}
      </span>
      {meta.label}
      {detail ? ` · ${detail}` : ''}
    </span>
  );
}

/** The mono eyebrow at the top of a card: a colour chip, a label, a hairline. */
export function KindStrip({
  label,
  accent,
  gradient,
  right,
  style,
}: {
  label: string;
  accent?: Accent;
  /** Overrides the chip fill when a card wants a gradient mark. */
  gradient?: string;
  right?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, ...style }}>
      <span
        style={{
          width: 14,
          height: 14,
          borderRadius: 5,
          background: gradient ?? (accent ? accentColor[accent] : color.textFaint),
          display: 'block',
          flex: 'none',
        }}
      />
      <span
        style={{
          fontFamily: font.mono,
          fontSize: 10,
          letterSpacing: '.07em',
          color: color.textFaint,
        }}
      >
        {label}
      </span>
      <span style={{ height: 1, flex: 1, background: color.borderSoft }} />
      {right}
    </div>
  );
}

/** Mono meta line: "AGENT BUILDER · 6 AGENTS · 12M". */
export function MonoMeta({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        fontFamily: font.mono,
        fontSize: 10,
        color: color.textGhost,
        marginTop: 5,
        letterSpacing: '.04em',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/**
 * Ownership state. Deliberately quiet — an unclaimed agent is a normal member
 * of the network, not a warning.
 */
export function ClaimBadge({ status, style }: { status: ClaimStatus; style?: CSSProperties }) {
  const label = claimStatusLabel(status);
  if (!label) return null;
  const pending = status === 'pending';
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 9px',
        borderRadius: 8,
        background: pending ? '#FFF6E8' : color.surfaceSunken,
        border: `1px solid ${pending ? '#F2E2C8' : color.borderInput}`,
        fontSize: 11.5,
        fontWeight: 500,
        color: pending ? color.amberText : color.textSecondary,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: 99,
          background: pending ? color.amber : color.textGhost,
          display: 'block',
        }}
      />
      {label}
    </span>
  );
}

/** Capability pill used on launch cards and promotions. */
export function Tag({ children, tone = 'light' }: { children: ReactNode; tone?: 'light' | 'plain' }) {
  return (
    <span
      style={{
        padding: '5px 11px',
        borderRadius: 9,
        background: tone === 'light' ? 'rgba(255,255,255,.75)' : color.surfaceSunken,
        border: tone === 'plain' ? `1px solid ${color.borderInput}` : undefined,
        fontSize: 12.5,
        color: color.textStrong,
        fontWeight: 500,
      }}
    >
      {children}
    </span>
  );
}
