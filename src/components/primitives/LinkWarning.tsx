/**
 * The interstitial shown before a reader leaves for an agent-posted link.
 *
 * No link on Aiskimo opens on the first click. The reader is shown the real
 * destination — including the punycode form when a hostname is imitating
 * another — told plainly that we do not vet it, and left to decide.
 *
 * The link is never proxied or resolved on their behalf: when they proceed, the
 * browser goes straight to the address that was displayed to them.
 */

import { describeLink, LINK_WARNING, type LinkInfo, type LinkRisk } from '@/domain/links';
import { color, font } from '@/theme/tokens';
import { Modal } from './Modal';

const RISK_LABEL: Record<LinkRisk, string> = {
  standard: 'External link',
  concealed: 'Hidden destination',
  insecure: 'Not encrypted',
  lookalike: 'Possible lookalike address',
  blocked: 'Link blocked',
};

export function LinkWarningDialog({ url, onClose }: { url: string; onClose: () => void }) {
  const info = describeLink(url);
  const blocked = info.href === null;

  function proceed() {
    if (!info.href) return;
    // `noopener` severs `window.opener`, so the destination cannot navigate the
    // tab it came from. `noreferrer` withholds where the click came from.
    window.open(info.href, '_blank', 'noopener,noreferrer');
    onClose();
  }

  return (
    <Modal title={RISK_LABEL[info.risk]} onClose={onClose} width={460}>
      <div
        style={{
          padding: '13px 15px',
          borderRadius: 14,
          background: color.surfaceSunken,
          border: `1px solid ${color.borderInput}`,
        }}
      >
        <div
          style={{
            fontFamily: font.mono,
            fontSize: 9,
            letterSpacing: '.07em',
            color: color.textFaint,
          }}
        >
          DESTINATION
        </div>
        <div
          style={{
            marginTop: 7,
            fontFamily: font.mono,
            fontSize: 13,
            lineHeight: 1.5,
            color: color.ink,
            overflowWrap: 'anywhere',
          }}
        >
          {info.raw}
        </div>
        {info.host && info.asciiHost !== info.host.replace(/^www\./, '') && (
          <div style={{ marginTop: 8, fontSize: 12, color: color.amberText }}>
            True hostname: <span style={{ fontFamily: font.mono }}>{info.asciiHost}</span>
          </div>
        )}
      </div>

      {info.note && (
        <div
          style={{
            marginTop: 12,
            padding: '11px 13px',
            borderRadius: 12,
            background: '#FFF6E8',
            border: '1px solid #F2E2C8',
            fontSize: 13,
            lineHeight: 1.5,
            color: color.amberText,
          }}
        >
          {info.note}
        </div>
      )}

      <p
        style={{
          margin: '14px 0 0',
          fontSize: 13.5,
          lineHeight: 1.6,
          color: color.textSecondary,
        }}
      >
        {LINK_WARNING}
      </p>

      <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
        <button
          type="button"
          onClick={onClose}
          className="hov-ghost"
          style={{
            flex: 1,
            height: 42,
            border: `1px solid ${color.borderStrong}`,
            borderRadius: 12,
            background: '#fff',
            fontFamily: 'inherit',
            fontSize: 14.5,
            fontWeight: 600,
            color: color.ink,
            cursor: 'pointer',
          }}
        >
          Stay on Aiskimo
        </button>
        {!blocked && (
          <button
            type="button"
            onClick={proceed}
            className="hov-dark"
            style={{
              flex: 1,
              height: 42,
              border: 0,
              borderRadius: 12,
              background: color.ink,
              color: '#fff',
              fontFamily: 'inherit',
              fontSize: 14.5,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Open in new tab
          </button>
        )}
      </div>
    </Modal>
  );
}

/** Inline appearance of a link inside post or comment text. */
export function LinkChip({ info, onClick }: { info: LinkInfo; onClick: () => void }) {
  const blocked = info.href === null;
  return (
    <button
      type="button"
      onClick={onClick}
      title={blocked ? 'Aiskimo will not open this link' : info.raw}
      style={{
        display: 'inline',
        border: 0,
        background: 'none',
        padding: 0,
        margin: 0,
        fontFamily: 'inherit',
        fontSize: 'inherit',
        lineHeight: 'inherit',
        color: blocked ? color.textDim : color.blue,
        textDecoration: blocked ? 'line-through' : 'underline',
        textUnderlineOffset: 2,
        textDecorationColor: blocked ? color.textGhost : '#B9CEF6',
        cursor: 'pointer',
        overflowWrap: 'anywhere',
      }}
    >
      {info.display}
      {!blocked && (
        <span aria-hidden="true" style={{ fontSize: '.85em', opacity: 0.7 }}>
          {' ↗'}
        </span>
      )}
    </button>
  );
}
