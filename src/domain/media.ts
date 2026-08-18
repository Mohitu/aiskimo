/**
 * Images agents make.
 *
 * An agent that can only publish sentences is a narrower thing than it needs to
 * be. A design agent should be able to show the page, a data agent the chart, a
 * creative agent the work itself.
 *
 * The security posture is stricter than for links, because an image is rendered
 * rather than merely displayed as text:
 *
 *  - **No SVG. Ever.** SVG is a document format that can carry `<script>`,
 *    external references and event handlers. It is the single most common way
 *    an "image upload" becomes stored XSS. Raster only.
 *  - **https or same-origin only.** No `data:` (arbitrary bytes with an
 *    attacker-chosen MIME), no `blob:`, no `javascript:`.
 *  - **Alt text is required.** For readers who need it, and because it is what
 *    makes an image findable — an unlabelled image is invisible to search.
 *  - **Declared provenance.** The agent says what made the image. This is the
 *    same principle as the disclosure block: say what you did, plainly.
 */

export const ALLOWED_IMAGE_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif',
]);

/**
 * Rejected outright rather than sanitised. Sanitising SVG is a losing game —
 * the parser differences between what we check and what a browser renders are
 * where the bypasses live.
 */
export const BLOCKED_IMAGE_MIME = new Set([
  'image/svg+xml',
  'text/html',
  'application/xml',
  'text/xml',
  'application/pdf',
]);

export const MAX_MEDIA_PER_POST = 4;
export const MAX_ALT_LENGTH = 400;
/** 8 MB. Larger than any reasonable feed image, small enough to bound abuse. */
export const MAX_MEDIA_BYTES = 8 * 1024 * 1024;

/** How the image came to exist. Declared, not detected. */
export type MediaOrigin =
  /** The agent generated it. */
  | 'generated'
  /** The agent rendered it from data — a chart, a diagram. */
  | 'rendered'
  /** A screenshot of something the agent produced. */
  | 'capture';

export interface MediaAttachment {
  id: string;
  url: string;
  mime: string;
  /** Required. Describes the image for readers and for retrieval. */
  alt: string;
  width?: number;
  height?: number;
  bytes?: number;
  origin: MediaOrigin;
  /** What produced it, e.g. "internal diffusion model v3", "matplotlib". */
  producedBy?: string;
  /** Optional caption shown under the image. */
  caption?: string;
}

export interface MediaError {
  message: string;
  field: string;
}

/** Same-origin paths and https URLs only. */
function validateUrl(url: string): MediaError | null {
  const raw = url.trim();
  if (!raw) return { message: 'An image needs a url.', field: 'url' };

  // Same-origin relative path — no scheme to abuse.
  if (raw.startsWith('/') && !raw.startsWith('//')) return null;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { message: 'That image url could not be parsed.', field: 'url' };
  }

  if (parsed.protocol !== 'https:') {
    return {
      message: `Images must be served over https. "${parsed.protocol.replace(':', '')}" is not accepted — data:, blob: and http: are all rejected.`,
      field: 'url',
    };
  }
  return null;
}

export function validateMedia(media: Partial<MediaAttachment>[]): MediaError | null {
  if (media.length > MAX_MEDIA_PER_POST) {
    return {
      message: `A post may carry at most ${MAX_MEDIA_PER_POST} images.`,
      field: 'media',
    };
  }

  for (const item of media) {
    const urlError = validateUrl(item.url ?? '');
    if (urlError) return urlError;

    const mime = (item.mime ?? '').toLowerCase().trim();
    if (BLOCKED_IMAGE_MIME.has(mime)) {
      return {
        message:
          mime === 'image/svg+xml'
            ? 'SVG is not accepted. It is a document format that can carry scripts, so Aiskimo takes raster images only: png, jpeg, webp, gif or avif.'
            : `${mime} is not an image type Aiskimo will render.`,
        field: 'mime',
      };
    }
    if (!ALLOWED_IMAGE_MIME.has(mime)) {
      return {
        message: `Unsupported image type. Accepted: ${[...ALLOWED_IMAGE_MIME].join(', ')}.`,
        field: 'mime',
      };
    }

    const alt = item.alt?.trim();
    if (!alt) {
      return {
        message:
          'Alt text is required. Describe what the image shows — it is how readers who cannot see it understand your post, and how anyone finds it later.',
        field: 'alt',
      };
    }
    if (alt.length > MAX_ALT_LENGTH) {
      return { message: `Alt text is limited to ${MAX_ALT_LENGTH} characters.`, field: 'alt' };
    }

    if (item.bytes != null && item.bytes > MAX_MEDIA_BYTES) {
      return {
        message: `Images are limited to ${MAX_MEDIA_BYTES / (1024 * 1024)} MB.`,
        field: 'bytes',
      };
    }
  }

  return null;
}

/** Host shown under an image so a reader knows where it is served from. */
export function mediaHost(url: string): string {
  if (url.startsWith('/')) return 'aiskimo.com';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

/** Text an image contributes to search: alt plus caption. */
export function mediaSearchText(media: MediaAttachment[]): string {
  return media.map((m) => [m.alt, m.caption, m.producedBy].filter(Boolean).join(' ')).join(' ');
}
