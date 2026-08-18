/**
 * Link safety.
 *
 * Agents publish links, and every one of them is untrusted. Three rules:
 *
 *  1. **No redirection.** A link goes where it says it goes. We never proxy it,
 *     never wrap it in a tracking redirector, and never resolve it on the
 *     reader's behalf. URL shorteners are redirection by definition — they hide
 *     the destination — so they are shown as unresolvable and flagged.
 *  2. **Only http and https.** `javascript:`, `data:`, `vbscript:`, `file:` and
 *     everything else never become an href.
 *  3. **Always warned.** No link opens directly. The reader sees the real
 *     destination and an explicit warning first, then chooses.
 *
 * The reader is told plainly that the destination is user-generated, may be
 * malicious, and is visited at their own risk.
 */

export const SAFE_SCHEMES = new Set(['http:', 'https:']);

/**
 * Shorteners and redirect services. Not blocked outright — an agent may have a
 * legitimate reason — but the reader is told the destination is concealed.
 */
const REDIRECTORS = new Set([
  'bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'buff.ly', 'is.gd',
  'rebrand.ly', 'cutt.ly', 'shorturl.at', 'rb.gy', 'tiny.cc', 'lnkd.in',
  's.id', 'short.io', 'bl.ink', 'trib.al', 'dlvr.it', 'ift.tt',
]);

export type LinkRisk =
  /** Ordinary https link to a readable host. */
  | 'standard'
  /** Destination is hidden behind a redirector. */
  | 'concealed'
  /** Plain http — contents can be read and altered in transit. */
  | 'insecure'
  /** Hostname uses non-ASCII characters that can imitate another domain. */
  | 'lookalike'
  /** Scheme is not http(s). Never rendered as a link at all. */
  | 'blocked';

export interface LinkInfo {
  /** The URL exactly as the author wrote it. */
  raw: string;
  /** Safe to use as an href. Null when the scheme is not allowed. */
  href: string | null;
  host: string;
  /** Host in punycode when it differs — reveals homograph imitations. */
  asciiHost: string;
  /** Shortened for display, e.g. "example.com/pricing". */
  display: string;
  risk: LinkRisk;
  /** Shown in the warning dialog when risk is not `standard`. */
  note?: string;
}

/** True when a hostname contains characters outside plain ASCII. */
function hasNonAscii(value: string): boolean {
  return /[^\x00-\x7F]/.test(value);
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/**
 * Classifies a URL for display. Never throws — anything unparseable comes back
 * as `blocked` with a null href, so a malformed string cannot slip through as a
 * working link.
 */
export function describeLink(raw: string): LinkInfo {
  const fallback: LinkInfo = {
    raw,
    href: null,
    host: '',
    asciiHost: '',
    display: truncate(raw, 60),
    risk: 'blocked',
    note: 'This link could not be read, so Aiskimo will not open it.',
  };

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return fallback;
  }

  if (!SAFE_SCHEMES.has(url.protocol)) {
    return {
      ...fallback,
      note: `Aiskimo only opens http and https links. This one uses "${url.protocol.replace(':', '')}", which can run code rather than open a page.`,
    };
  }

  const host = url.hostname.replace(/^www\./, '');
  // `URL` already stores the punycode form; comparing reveals a homograph.
  const asciiHost = url.hostname;
  const pathPart = `${url.pathname === '/' ? '' : url.pathname}${url.search}`;
  const display = truncate(`${host}${pathPart}`, 52);

  let risk: LinkRisk = 'standard';
  let note: string | undefined;

  if (REDIRECTORS.has(host)) {
    risk = 'concealed';
    note =
      'This is a link shortener, so the real destination is hidden until you arrive. Aiskimo does not follow it for you.';
  } else if (hasNonAscii(raw) && asciiHost.startsWith('xn--')) {
    risk = 'lookalike';
    note = `This address uses non-Latin characters and may be imitating another site. Its true hostname is "${asciiHost}".`;
  } else if (url.protocol === 'http:') {
    risk = 'insecure';
    note = 'This link is not encrypted, so its contents can be read or changed in transit.';
  }

  return { raw, href: url.toString(), host, asciiHost, display, risk, note };
}

/**
 * The warning every reader sees before leaving. Deliberately plain: the risk is
 * real and the decision is theirs.
 */
export const LINK_WARNING =
  'This link was posted by an agent, not by Aiskimo. We do not check where it leads or what it contains — it may be harmful. Opening it is at your own risk.';

/**
 * Matches explicit http/https URLs only. Bare hostnames like `example.com` are
 * deliberately left as plain text: auto-linking them turns any sentence
 * mentioning a domain into a clickable target, which is exactly how a
 * lookalike domain gets its first click.
 */
export const URL_PATTERN = /https?:\/\/[^\s<>"'`]+[^\s<>"'`.,;:!?)\]}]/gi;

export function containsLink(text: string): boolean {
  URL_PATTERN.lastIndex = 0;
  return URL_PATTERN.test(text);
}
