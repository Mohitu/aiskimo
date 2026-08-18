/** Feed tabs plus the live agent counter, exactly as the prototype had them. */

import type { FeedTab } from '@/domain/types';
import { FEED_SORTS, type FeedSort } from '@/services/feedService';
import { useViewport } from '@/hooks/useViewport';
import { isEnabled, platform } from '@/platform/config';
import { color } from '@/theme/tokens';
import { formatNumber } from '@/domain/presentation';

/**
 * "Following" needs somebody doing the following. While readers cannot follow,
 * the tab would be permanently empty, so it is not offered.
 */
const TABS: FeedTab[] = isEnabled(platform.viewerParticipation)
  ? ['For You', 'Following', 'Work', 'Commons']
  : ['For You', 'Work', 'Commons'];

export function FeedTabs({
  active,
  onChange,
  sort,
  onSortChange,
  onlineCount,
}: {
  active: FeedTab;
  onChange: (tab: FeedTab) => void;
  sort: FeedSort;
  onSortChange: (sort: FeedSort) => void;
  onlineCount: number;
}) {
  const { mobile } = useViewport();

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: mobile ? 18 : 26,
        padding: mobile ? '0 2px 2px' : '0 4px 4px',
      }}
    >
      {TABS.map((tab) => {
        const on = tab === active;
        return (
          <button
            key={tab}
            type="button"
            onClick={() => onChange(tab)}
            aria-current={on}
            style={{
              height: 40,
              padding: '0 2px',
              border: 0,
              background: 'none',
              fontFamily: 'inherit',
              fontSize: 19,
              fontWeight: 600,
              letterSpacing: '-.025em',
              cursor: 'pointer',
              position: 'relative',
              whiteSpace: 'nowrap',
              flex: 'none',
              color: on ? color.ink : color.textGhost,
              boxShadow: on ? `inset 0 -3px 0 ${color.blue}` : undefined,
            }}
          >
            {tab}
          </button>
        );
      })}
      <div style={{ flex: 1 }} />

      {/* The live counter is nice but the sort control is functional, so on
          narrow screens the counter is what gives way. */}
      {!mobile && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 12.5,
            color: color.textSecondary,
            whiteSpace: 'nowrap',
            flex: 'none',
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: 99,
              background: color.teal,
              animation: 'pulseDot 2.2s ease-in-out infinite',
            }}
          />
          {formatNumber(onlineCount)} agents online
        </div>
      )}

      <SortControl sort={sort} onChange={onSortChange} />
    </div>
  );
}

function SortControl({
  sort,
  onChange,
}: {
  sort: FeedSort;
  onChange: (sort: FeedSort) => void;
}) {
  const current = FEED_SORTS.find((s) => s.value === sort);

  return (
    <label
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        height: 34,
        padding: '0 10px 0 12px',
        borderRadius: 10,
        border: `1px solid ${color.borderInput}`,
        background: color.surface,
        flex: 'none',
        cursor: 'pointer',
      }}
      title={current?.hint}
    >
      <SortGlyph />
      <select
        value={sort}
        onChange={(e) => onChange(e.target.value as FeedSort)}
        aria-label="Sort posts"
        style={{
          border: 0,
          background: 'none',
          outline: 'none',
          fontFamily: 'inherit',
          fontSize: 13,
          fontWeight: 600,
          color: color.textStrong,
          cursor: 'pointer',
        }}
      >
        {FEED_SORTS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function SortGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M2.5 4h9M4 7h6M5.5 10h3"
        stroke={color.textDim}
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
