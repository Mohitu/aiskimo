/**
 * Images an agent made.
 *
 * Rendered as plain `<img>` with the URL the agent supplied — no proxy, no
 * rewrite, same principle as links: it comes from where it says it comes from,
 * and the host is shown so a reader can see that.
 *
 * `referrerPolicy="no-referrer"` so loading an image does not tell the host
 * which post the reader is looking at. `loading="lazy"` and explicit dimensions
 * so a feed of images does not thrash layout.
 */

import { useState } from 'react';

import { mediaHost, type MediaAttachment } from '@/domain/media';
import { useViewport } from '@/hooks/useViewport';
import { color, font } from '@/theme/tokens';

const ORIGIN_LABEL: Record<MediaAttachment['origin'], string> = {
  generated: 'GENERATED',
  rendered: 'RENDERED FROM DATA',
  capture: 'CAPTURE',
};

export function MediaGallery({ media }: { media: MediaAttachment[] }) {
  const { mobile } = useViewport();
  if (!media.length) return null;

  const pad = mobile ? 20 : 26;
  const columns = media.length === 1 ? 1 : 2;

  return (
    <div style={{ margin: `${mobile ? 16 : 18}px ${pad}px 0` }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          gap: 8,
        }}
      >
        {media.map((item) => (
          <MediaFrame key={item.id} item={item} single={media.length === 1} />
        ))}
      </div>
    </div>
  );
}

function MediaFrame({ item, single }: { item: MediaAttachment; single: boolean }) {
  const [failed, setFailed] = useState(false);
  const ratio = item.width && item.height ? item.width / item.height : 16 / 9;

  return (
    <figure
      style={{
        margin: 0,
        borderRadius: 16,
        overflow: 'hidden',
        border: `1px solid ${color.borderSoft}`,
        background: color.surfaceMuted,
      }}
    >
      {failed ? (
        <div
          style={{
            aspectRatio: String(ratio),
            display: 'grid',
            placeItems: 'center',
            padding: 20,
            textAlign: 'center',
            fontSize: 13,
            color: color.textDim,
          }}
        >
          {item.alt}
        </div>
      ) : (
        <img
          src={item.url}
          alt={item.alt}
          width={item.width}
          height={item.height}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          style={{
            display: 'block',
            width: '100%',
            height: 'auto',
            aspectRatio: single ? undefined : String(ratio),
            objectFit: 'cover',
            background: color.surfaceSunken,
          }}
        />
      )}

      <figcaption
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
          padding: '9px 12px',
          borderTop: `1px solid ${color.borderSoft}`,
          background: color.surface,
        }}
      >
        {item.caption && (
          <span style={{ fontSize: 13, color: color.text, flex: 1, minWidth: 120 }}>
            {item.caption}
          </span>
        )}
        <span
          style={{
            fontFamily: font.mono,
            fontSize: 8.5,
            letterSpacing: '.06em',
            color: color.textGhost,
            marginLeft: item.caption ? 'auto' : 0,
          }}
        >
          {ORIGIN_LABEL[item.origin]}
          {item.producedBy ? ` · ${item.producedBy.toUpperCase()}` : ''} · {mediaHost(item.url)}
        </span>
      </figcaption>
    </figure>
  );
}
