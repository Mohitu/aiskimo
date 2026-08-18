/** Mobile bottom navigation, matching the prototype's five-slot bar. */

import type { Viewer } from '@/domain/types';
import { isEnabled, platform } from '@/platform/config';
import { useNavigation } from '@/state/NavigationContext';
import { color } from '@/theme/tokens';
import { DocsIcon, ExploreIcon, HomeIcon, IglooIcon } from './Icons';

export function BottomNav({
  viewer,
  canCreate,
  onCreate,
}: {
  viewer: Viewer | null;
  /** Visitors have nothing to create — the slot becomes Explore instead. */
  canCreate: boolean;
  onCreate: () => void;
}) {
  const { openDocs, goHome } = useNavigation();

  return (
    <nav
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 190,
        display: 'grid',
        // The centre slot exists only for the create button. Without it, four
        // even columns beat a gap where a button used to be.
        gridTemplateColumns: canCreate ? 'repeat(5,1fr)' : 'repeat(4,1fr)',
        alignItems: 'center',
        height: 66,
        paddingBottom: 6,
        background: 'rgba(255,255,255,.94)',
        backdropFilter: 'blur(18px)',
        borderTop: `1px solid ${color.border}`,
      }}
    >
      <NavSlot label="Home" active onClick={goHome}>
        <HomeIcon stroke={color.blue} size={21} />
      </NavSlot>
      <NavSlot label="Explore" soon={!isEnabled(platform.surfaces.explore)}>
        <ExploreIcon stroke={color.textGhost} size={21} />
      </NavSlot>

      {canCreate && (
        <div
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 56 }}
        >
          <button
            type="button"
            onClick={onCreate}
            aria-label="Create agent"
            style={{
              width: 50,
              height: 50,
              border: 0,
              borderRadius: 17,
              background: color.blue,
              color: '#fff',
              fontFamily: 'inherit',
              fontSize: 24,
              lineHeight: 1,
              cursor: 'pointer',
              boxShadow: '0 8px 20px -8px rgba(47,107,232,.95)',
            }}
          >
            +
          </button>
        </div>
      )}

      <NavSlot label="Igloos" soon={!isEnabled(platform.surfaces.igloos)}>
        <IglooIcon stroke={color.textGhost} size={21} />
      </NavSlot>
      {/* A visitor has no account, so "Saved" was a bookmark icon wired to
          nothing — and with the rail being desktop-only, the docs had no mobile
          entry point at all except a dialog about registering. The dead slot
          becomes the missing one. */}
      {viewer ? (
        <NavSlot label="You">
          <div
            style={{
              width: 22,
              height: 22,
              borderRadius: 99,
              background: 'linear-gradient(145deg,#D9DEE6,#7C8896)',
              display: 'grid',
              placeItems: 'center',
              color: '#fff',
              fontSize: 10,
              fontWeight: 600,
            }}
          >
            {viewer.account.avatar.initials}
          </div>
        </NavSlot>
      ) : (
        <NavSlot label="Docs" onClick={openDocs}>
          <DocsIcon stroke={color.textFaint} size={21} />
        </NavSlot>
      )}
    </nav>
  );
}

function NavSlot({
  children,
  label,
  active,
  soon,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  active?: boolean;
  /** Section not open yet — shown dimmed with a dot rather than removed. */
  soon?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      aria-disabled={soon}
      title={soon ? 'Coming soon' : undefined}
      role={onClick && !soon ? 'button' : undefined}
      tabIndex={onClick && !soon ? 0 : undefined}
      onClick={soon ? undefined : onClick}
      onKeyDown={(e) => {
        if (soon || !onClick) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 5,
        height: 56,
        justifyContent: 'center',
        cursor: soon ? 'default' : 'pointer',
        opacity: soon ? 0.55 : 1,
        position: 'relative',
      }}
    >
      {children}
      <span
        style={{
          fontSize: 10.5,
          fontWeight: active ? 600 : 500,
          color: active ? color.blue : color.textFaint,
        }}
      >
        {label}
      </span>
      {soon && (
        <span
          style={{
            position: 'absolute',
            top: 6,
            right: '50%',
            marginRight: -18,
            width: 5,
            height: 5,
            borderRadius: 99,
            background: color.borderStrong,
          }}
        />
      )}
    </div>
  );
}
