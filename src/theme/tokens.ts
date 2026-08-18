/**
 * Design tokens taken verbatim from the Aiskimo prototype. Components must
 * reference these rather than re-typing hex values, so the visual language
 * stays in one place.
 */

import type { Accent } from '@/domain/types';

export const color = {
  // Surfaces
  appBg: '#F4F7FA',
  marketingBg: '#F5F8FB',
  surface: '#FFFFFF',
  surfaceMuted: '#F7FAFC',
  surfaceSunken: '#F8FAFC',
  surfaceWarm: '#FFFBF4',

  // Borders
  border: '#E4EAF2',
  borderCard: '#E4EBF3',
  borderSoft: '#EDF1F6',
  borderInput: '#E2E9F1',
  borderStrong: '#D7E1EE',
  borderTint: '#E2ECF6',
  borderWarm: '#F6EBD9',

  // Text
  ink: '#10151C',
  inkDeep: '#111922',
  inkBody: '#141C25',
  inkQuote: '#1B242F',
  text: '#22303D',
  textStrong: '#3A4653',
  textMuted: '#4A5764',
  textSecondary: '#5C6875',
  textFaint: '#7A8794',
  textDim: '#8A96A3',
  textGhost: '#A3ADB8',
  hairline: '#C3CCD6',

  // Brand
  blue: '#2F6BE8',
  blueDark: '#1E4FC0',
  blueSoft: '#E9F0FE',
  blueSofter: '#EDF3FE',
  navy: '#0E1B3D',

  teal: '#12A0A8',
  tealText: '#0A7B82',
  purple: '#6B48D8',
  amber: '#C77A16',
  amberText: '#A66A14',
  pink: '#D6376E',
  pinkSoft: '#FDEFF4',
  olive: '#5C8C1F',
} as const;

export const font = {
  sans: '"Instrument Sans", system-ui, sans-serif',
  serif: '"Instrument Serif", Georgia, serif',
  mono: '"JetBrains Mono", ui-monospace, monospace',
} as const;

/** Avatar fills. Studios use the flat navy tile; everyone else gets a gradient. */
export const accentGradient: Record<Accent, string> = {
  teal: 'linear-gradient(145deg,#A8F0DC,#12A0A8)',
  blue: 'linear-gradient(145deg,#8FD3F4,#2F6BE8)',
  purple: 'linear-gradient(145deg,#D9C4FF,#6B48D8)',
  amber: 'linear-gradient(145deg,#FFE1A8,#C77A16)',
  pink: 'linear-gradient(145deg,#FFC9D9,#D6376E)',
  olive: 'linear-gradient(145deg,#CFE0A8,#5C8C1F)',
  slate: 'linear-gradient(145deg,#D9DEE6,#7C8896)',
  navy: '#0E1B3D',
};

/** Base colour of an accent, used for halos, bars and diamond marks. */
export const accentColor: Record<Accent, string> = {
  teal: '#12A0A8',
  blue: '#2F6BE8',
  purple: '#6B48D8',
  amber: '#C77A16',
  pink: '#D6376E',
  olive: '#5C8C1F',
  slate: '#7C8896',
  navy: '#0E1B3D',
};

/** Translucent ring drawn around agent avatars. */
export const accentHalo: Record<Accent, string> = {
  teal: 'rgba(18,160,168,.13)',
  blue: 'rgba(47,107,232,.13)',
  purple: 'rgba(107,72,216,.13)',
  amber: 'rgba(199,122,22,.13)',
  pink: 'rgba(214,55,110,.12)',
  olive: 'rgba(92,140,31,.13)',
  slate: 'rgba(124,136,150,.12)',
  navy: 'rgba(14,27,61,.08)',
};

export const radius = {
  sm: 9,
  md: 12,
  lg: 16,
  xl: 18,
  card: 22,
  pill: 999,
} as const;

export const shadow = {
  card: '0 1px 2px rgba(16,38,72,.04)',
  raised: '0 18px 40px -22px rgba(16,38,72,.3),0 2px 6px rgba(16,38,72,.05)',
  menu: '0 24px 48px -18px rgba(16,38,72,.34)',
  blueBtn: '0 8px 22px -10px rgba(47,107,232,.95)',
} as const;

/** Breakpoints matching the prototype's media queries. */
export const breakpoint = {
  mobile: '(max-width: 760px)',
  narrow: '(max-width: 1140px)',
} as const;

/** Mono eyebrow used on every card strip and meta line. */
export const monoLabel = {
  fontFamily: font.mono,
  fontSize: 10,
  letterSpacing: '.07em',
  color: color.textFaint,
} as const;
