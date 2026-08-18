/**
 * The avatar tile. One component covers every size and shape the prototype
 * drew by hand: agent squircles with an accent halo, builder circles, studio
 * squares, plus the optional status dot and identity-verified mark.
 */

import type { CSSProperties } from 'react';
import type { AgentStatus, AvatarSpec } from '@/domain/types';
import { statusMeta } from '@/domain/presentation';
import { accentColor, accentGradient, accentHalo } from '@/theme/tokens';

interface AvatarProps {
  spec: AvatarSpec;
  size: number;
  /** Draws the coloured presence dot in the bottom-right corner. */
  status?: AgentStatus;
  /** Draws the white tile with the rotated accent mark — identity verified. */
  identityVerified?: boolean;
  /** Translucent ring around the tile. On by default for agents. */
  halo?: boolean;
  /** Overlapping stacks need a solid ring instead of a halo. */
  ringColor?: string;
  style?: CSSProperties;
}

function radiusFor(spec: AvatarSpec, size: number): number {
  if (spec.shape === 'circle') return 999;
  if (spec.shape === 'square') return Math.round(size * 0.28);
  return Math.round(size * 0.33);
}

export function Avatar({
  spec,
  size,
  status,
  identityVerified,
  halo = true,
  ringColor,
  style,
}: AvatarProps) {
  const radius = radiusFor(spec, size);
  const dotSize = Math.max(9, Math.round(size * 0.19));
  const meta = status ? statusMeta(status) : null;

  const shadows: string[] = [];
  if (halo && !ringColor) shadows.push(`0 0 0 ${size >= 50 ? 4 : 3}px ${accentHalo[spec.accent]}`);

  const tile: CSSProperties = {
    width: size,
    height: size,
    borderRadius: radius,
    background: spec.imageUrl ? `center/cover url(${spec.imageUrl})` : accentGradient[spec.accent],
    display: 'grid',
    placeItems: 'center',
    color: '#fff',
    fontSize: Math.round(size * 0.38 * 10) / 10,
    fontWeight: 600,
    boxShadow: shadows.join(',') || undefined,
    border: ringColor ? `2px solid ${ringColor}` : undefined,
    flex: 'none',
  };

  return (
    <div style={{ position: 'relative', flex: 'none', ...style }}>
      <div style={tile}>{spec.imageUrl ? '' : spec.initials}</div>

      {meta && (
        <span
          style={{
            position: 'absolute',
            right: -2,
            bottom: -2,
            width: dotSize,
            height: dotSize,
            borderRadius: 99,
            background: meta.dot,
            border: '2px solid #fff',
          }}
        />
      )}
      {meta?.pulse && (
        <span
          style={{
            position: 'absolute',
            right: -2,
            bottom: -2,
            width: dotSize,
            height: dotSize,
            borderRadius: 99,
            background: meta.dot,
            animation: 'aura 2.4s ease-out infinite',
          }}
        />
      )}

      {identityVerified && !status && (
        <div
          style={{
            position: 'absolute',
            right: -5,
            bottom: -5,
            width: Math.round(size * 0.36),
            height: Math.round(size * 0.36),
            borderRadius: Math.round(size * 0.13),
            background: '#fff',
            display: 'grid',
            placeItems: 'center',
            boxShadow: '0 1px 4px rgba(16,38,72,.22)',
          }}
        >
          <span
            style={{
              width: Math.round(size * 0.155),
              height: Math.round(size * 0.155),
              background: accentColor[spec.accent],
              transform: 'rotate(45deg)',
              display: 'block',
            }}
          />
        </div>
      )}
    </div>
  );
}

/** Overlapping row of avatars, as used on roster and portfolio cards. */
export function AvatarStack({
  specs,
  size = 26,
  overflow,
  ringColor = '#fff',
}: {
  specs: AvatarSpec[];
  size?: number;
  overflow?: number;
  ringColor?: string;
}) {
  const overlap = Math.round(size * 0.3);
  return (
    <div style={{ display: 'flex', alignItems: 'center', flex: 'none' }}>
      {specs.map((spec, i) => (
        <Avatar
          key={`${spec.initials}-${i}`}
          spec={spec}
          size={size}
          halo={false}
          ringColor={ringColor}
          style={i === 0 ? undefined : { marginLeft: -overlap }}
        />
      ))}
      {overflow ? (
        <div
          style={{
            width: size,
            height: size,
            borderRadius: Math.round(size * 0.33),
            background: '#EDF2F8',
            display: 'grid',
            placeItems: 'center',
            color: '#5C6875',
            fontSize: Math.round(size * 0.4),
            fontWeight: 600,
            marginLeft: -overlap,
            border: `2px solid ${ringColor}`,
          }}
        >
          +{overflow}
        </div>
      ) : null}
    </div>
  );
}
