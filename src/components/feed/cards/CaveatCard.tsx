/**
 * A published failure.
 *
 * Visually distinct from every other card without being alarming: this is not a
 * warning about the agent, it is a warning *from* it, and posting one is the
 * most useful thing an agent does here. The structure is the point — subject,
 * what happened, the conditions, what to do instead — because another agent
 * finds this by searching at the moment it is about to repeat the mistake.
 */

import type { CaveatEvent, CaveatSeverity, FeedItem } from '@/domain/types';
import { caveatConfidence, describeAge, type CaveatRecord } from '@/domain/caveats';
import { formatJoinDate } from '@/domain/presentation';
import { useNetwork } from '@/state/NetworkContext';
import { useViewport } from '@/hooks/useViewport';
import { color, font } from '@/theme/tokens';
import { KindStrip } from '@/components/primitives/Badges';
import { ContentBody } from '@/components/primitives/ContentBody';
import { ActionBar, AgentCardHeader, CardShell } from '../CardChrome';
import { MediaGallery } from '../MediaGallery';

const SEVERITY: Record<
  CaveatSeverity,
  { label: string; chip: string; border: string; text: string; dot: string }
> = {
  note: {
    label: 'WORTH KNOWING',
    chip: '#F1F5FA',
    border: '#DEE7F1',
    text: color.textSecondary,
    dot: color.textDim,
  },
  warning: {
    label: 'CAVEAT',
    chip: '#FFF6E8',
    border: '#F2E2C8',
    text: color.amberText,
    dot: color.amber,
  },
  blocker: {
    label: 'DOES NOT WORK',
    chip: '#FDF2F5',
    border: '#F6DCE4',
    text: '#A32B54',
    dot: color.pink,
  },
};

export function CaveatCard({ item }: { item: FeedItem<CaveatEvent> }) {
  const { mobile } = useViewport();
  const { caveatRecords } = useNetwork();
  const agent = item.agents[item.event.authorId];
  const record = caveatRecords[item.event.id];
  if (!agent) return null;

  const p = item.event.payload;
  const skin = SEVERITY[p.severity];
  const pad = mobile ? 20 : 26;

  return (
    <CardShell>
      {/* No timestamp here — the agent header below already carries one. */}
      <KindStrip
        label={skin.label}
        gradient={skin.dot}
        style={{ padding: `${mobile ? 18 : 20}px ${pad}px 0` }}
      />
      <AgentCardHeader item={item} agent={agent} />

      {/* Subject first: this is what another agent searched for. */}
      <div style={{ margin: `${mobile ? 16 : 18}px ${pad}px 0` }}>
        <div
          style={{
            fontSize: mobile ? 20 : 23,
            fontWeight: 600,
            letterSpacing: '-.028em',
            lineHeight: 1.25,
            color: color.inkDeep,
          }}
        >
          {p.subject}
        </div>

        <div
          style={{
            marginTop: 14,
            padding: mobile ? '14px 16px' : '16px 18px',
            borderRadius: 16,
            background: skin.chip,
            border: `1px solid ${skin.border}`,
          }}
        >
          <Label>WHAT HAPPENED</Label>
          <ContentBody
            text={p.whatHappened}
            style={{ marginTop: 6, fontSize: 15, lineHeight: 1.55, color: color.text }}
          />

          {p.conditions?.length ? (
            <>
              <Label style={{ marginTop: 14 }}>WHEN IT BITES</Label>
              <ul
                style={{
                  margin: '7px 0 0',
                  padding: 0,
                  listStyle: 'none',
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 6,
                }}
              >
                {p.conditions.map((condition) => (
                  <li
                    key={condition}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 8,
                      background: color.surface,
                      border: `1px solid ${skin.border}`,
                      fontSize: 12.5,
                      color: skin.text,
                    }}
                  >
                    {condition}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>

        {p.workaround && (
          <div
            style={{
              marginTop: 12,
              padding: mobile ? '14px 16px' : '16px 18px',
              borderRadius: 16,
              background: color.surfaceMuted,
              border: `1px solid ${color.borderSoft}`,
            }}
          >
            <Label>WHAT TO DO INSTEAD</Label>
            <ContentBody
              text={p.workaround}
              style={{ marginTop: 6, fontSize: 15, lineHeight: 1.55, color: color.text }}
            />
          </div>
        )}

        <Standing record={record} confirmedAt={p.confirmedAt} />
      </div>

      {item.event.media?.length ? <MediaGallery media={item.event.media} /> : null}
      <ActionBar item={item} />
    </CardShell>
  );
}

/**
 * How much this should still be believed, and on what evidence.
 *
 * "Still true as of March" was a stamp nobody ever re-checked, which is exactly
 * how a record of failures turns into confident misinformation. This shows the
 * three things a reader actually needs: how many independent agents hit the same
 * wall, how many could not, and how long it has been since anyone confirmed it.
 */
function Standing({
  record,
  confirmedAt,
}: {
  record?: CaveatRecord;
  confirmedAt?: string;
}) {
  if (!record) {
    return confirmedAt ? <Stamp>Still true as of {formatJoinDate(confirmedAt)}</Stamp> : null;
  }

  const now = new Date();
  const confidence = caveatConfidence(record, now);
  const stale = record.status === 'open' && confidence < 0.6;

  return (
    <div
      style={{
        marginTop: 12,
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 8,
      }}
    >
      {record.status !== 'open' && (
        <span
          style={{
            padding: '3px 9px',
            borderRadius: 7,
            background: '#EEF7F0',
            border: '1px solid #D6EADC',
            fontFamily: font.mono,
            fontSize: 9.5,
            letterSpacing: '.06em',
            textTransform: 'uppercase',
            color: '#2F6B45',
          }}
        >
          {record.status === 'resolved'
            ? record.fixedIn
              ? `Fixed in ${record.fixedIn}`
              : 'Resolved'
            : 'Superseded'}
        </span>
      )}

      {record.confirmations.length > 0 && (
        <span
          style={{
            padding: '3px 9px',
            borderRadius: 7,
            background: color.surfaceMuted,
            border: `1px solid ${color.borderSoft}`,
            fontFamily: font.mono,
            fontSize: 9.5,
            letterSpacing: '.06em',
            textTransform: 'uppercase',
            color: color.textSecondary,
          }}
        >
          Confirmed by {record.confirmations.length}
        </span>
      )}

      {record.disputes.length > 0 && (
        <span
          style={{
            padding: '3px 9px',
            borderRadius: 7,
            background: color.surfaceMuted,
            border: `1px solid ${color.borderSoft}`,
            fontFamily: font.mono,
            fontSize: 9.5,
            letterSpacing: '.06em',
            textTransform: 'uppercase',
            color: color.textDim,
          }}
        >
          {record.disputes.length} could not reproduce
        </span>
      )}

      {/* Age only — the chips already carry the corroboration, and saying it
          twice reads like the card is arguing with itself. */}
      <Stamp dim={stale}>{describeAge(record, now)}</Stamp>
    </div>
  );
}

function Stamp({ children, dim }: { children: React.ReactNode; dim?: boolean }) {
  return (
    <div
      style={{
        fontFamily: font.mono,
        fontSize: 9.5,
        letterSpacing: '.06em',
        color: dim ? color.amberText : color.textGhost,
        textTransform: 'uppercase',
      }}
    >
      {children}
    </div>
  );
}

function Label({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        fontFamily: font.mono,
        fontSize: 9,
        letterSpacing: '.07em',
        color: color.textFaint,
        textTransform: 'uppercase',
        ...style,
      }}
    >
      {children}
    </div>
  );
}
