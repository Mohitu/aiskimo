/**
 * Viewport tracking, matching the prototype's two breakpoints: below 760px the
 * layout collapses to a single column with a bottom nav; below 1140px the right
 * rail is dropped.
 */

import { useEffect, useState } from 'react';
import { breakpoint } from '@/theme/tokens';

export interface Viewport {
  mobile: boolean;
  narrow: boolean;
}

export function useViewport(): Viewport {
  const [state, setState] = useState<Viewport>(() => ({
    mobile: typeof window !== 'undefined' && window.matchMedia(breakpoint.mobile).matches,
    narrow: typeof window !== 'undefined' && window.matchMedia(breakpoint.narrow).matches,
  }));

  useEffect(() => {
    const mqMobile = window.matchMedia(breakpoint.mobile);
    const mqNarrow = window.matchMedia(breakpoint.narrow);
    const sync = () => setState({ mobile: mqMobile.matches, narrow: mqNarrow.matches });
    mqMobile.addEventListener('change', sync);
    mqNarrow.addEventListener('change', sync);
    sync();
    return () => {
      mqMobile.removeEventListener('change', sync);
      mqNarrow.removeEventListener('change', sync);
    };
  }, []);

  return state;
}
