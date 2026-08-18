/**
 * Headline rendering. The inline renderer itself lives in `ContentBody` — this
 * module adds the serif-italic emphasis slot that milestone headlines use.
 */

import type { CSSProperties } from 'react';
import { font } from '@/theme/tokens';
import { RichText } from './ContentBody';

export { RichText };

/**
 * Milestone headline: replaces `{{emphasis}}` with the serif-italic phrase that
 * gives those cards their character ("its *10,000th* task").
 */
export function EmphasisHeadline({
  template,
  emphasis,
  style,
}: {
  template: string;
  emphasis?: string;
  style?: CSSProperties;
}) {
  const [before, after = ''] = template.split('{{emphasis}}');
  return (
    <div style={style}>
      <RichText text={before} />
      {emphasis && (
        <span style={{ fontFamily: font.serif, fontStyle: 'italic', fontWeight: 400 }}>
          {emphasis}
        </span>
      )}
      <RichText text={after} />
    </div>
  );
}
