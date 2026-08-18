/** The line icons from the prototype, kept as one small set. */

export function HomeIcon({ stroke = '#3A4653', size = 19 }: { stroke?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none">
      <path
        d="M3 7.6L9 3l6 4.6V14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7.6Z"
        stroke={stroke}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ExploreIcon({ stroke = '#3A4653', size = 19 }: { stroke?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none">
      <circle cx="9" cy="9" r="6.2" stroke={stroke} strokeWidth="1.6" />
      <path
        d="M11.4 6.6L7.9 7.9 6.6 11.4l3.5-1.3 1.3-3.5Z"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IglooIcon({ stroke = '#3A4653', size = 19 }: { stroke?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none">
      <path
        d="M2.6 13.4a6.4 6.4 0 0 1 12.8 0H2.6Z"
        stroke={stroke}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M7.4 13.4v-2.6h3.2v2.6" stroke={stroke} strokeWidth="1.5" />
    </svg>
  );
}

export function MarketplaceIcon({
  stroke = '#3A4653',
  size = 19,
}: {
  stroke?: string;
  size?: number;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none">
      <rect x="3.2" y="3.2" width="5" height="5" rx="1.4" stroke={stroke} strokeWidth="1.6" />
      <rect x="9.8" y="3.2" width="5" height="5" rx="1.4" stroke={stroke} strokeWidth="1.6" />
      <rect x="3.2" y="9.8" width="5" height="5" rx="1.4" stroke={stroke} strokeWidth="1.6" />
      <rect x="9.8" y="9.8" width="5" height="5" rx="1.4" stroke={stroke} strokeWidth="1.6" />
    </svg>
  );
}

export function DocsIcon({ stroke = '#3A4653', size = 19 }: { stroke?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none">
      <path
        d="M4.2 3.4h6.2l3.4 3.4v7.8a1 1 0 0 1-1 1H4.2a1 1 0 0 1-1-1V4.4a1 1 0 0 1 1-1Z"
        stroke={stroke}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M10.2 3.6v3.4h3.4" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M6 9.6h5M6 12h3.4" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flex: 'none' }}>
      <circle cx="7" cy="7" r="4.6" stroke="#8A96A3" strokeWidth="1.5" />
      <path d="M10.6 10.6L14 14" stroke="#8A96A3" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function MessagesIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path
        d="M3.4 4.6h11.2v7.2H9.6L6.4 14.2v-2.4H3.4V4.6Z"
        stroke="#3A4653"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function BellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path
        d="M4.6 8a4.4 4.4 0 0 1 8.8 0v3l1.2 1.8H3.4L4.6 11V8Z"
        stroke="#3A4653"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ChevronDown() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
      <path d="M2.5 4.5L6 8l3.5-3.5" stroke="#5C6875" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
