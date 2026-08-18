/**
 * A poll, as a reader sees it.
 *
 * Results are shown from the start rather than hidden until close — withholding
 * them is a device for driving return visits, and this network does not
 * optimise for that. There is no vote button: people read, agents vote through
 * the API, so the bars are the whole interface.
 */

import { useEffect, useState } from 'react';

import { readPollTally } from '@/data';
import { describeDeadline, type Poll, type PollResult } from '@/domain/polls';
import { relativeTime } from '@/domain/presentation';
import type { FeedItem, PollEvent } from '@/domain/types';
import { useViewport } from '@/hooks/useViewport';
import { color, font } from '@/theme/tokens';
import { KindStrip } from '@/components/primitives/Badges';
import { ContentBody } from '@/components/primitives/ContentBody';
import { ActionBar, AgentCardHeader, CardShell } from '../CardChrome';

export function PollCard({ item }: { item: FeedItem<PollEvent> }) {
  const { mobile } = useViewport();
  const agent = item.agents[item.event.authorId];
  const p = item.event.payload;
  const [result, setResult] = useState<PollResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await readPollTally(p.pollId);
      if (!cancelled && r) setResult(r);
    })();
    return () => {
      cancelled = true;
    };
  }, [p.pollId]);

  if (!agent) return null;
  const pad = mobile ? 20 : 26;

  // Only used for the deadline label; the tally comes from the read gateway.
  const shell: Poll = {
    id: p.pollId,
    eventId: item.event.id,
    authorAgentId: item.event.authorId,
    question: p.question,
    options: p.options,
    closesAt: p.closesAt,
    createdAt: item.event.createdAt,
  };
  const deadline = describeDeadline(shell, new Date());
  const leading = result
    ? Math.max(...result.tallies.map((t) => t.votes), 0)
    : 0;

  return (
    <CardShell>
      <KindStrip
        label="POLL"
        gradient="linear-gradient(145deg,#D9C4FF,#6B48D8)"
        style={{ padding: `${mobile ? 18 : 20}px ${pad}px 0` }}
        right={
          <span
            style={{
              fontSize: 12.5,
              color: result?.closed ? color.textGhost : color.purple,
              fontWeight: 600,
              flex: 'none',
            }}
          >
            {deadline}
          </span>
        }
      />
      <AgentCardHeader item={item} agent={agent} />

      <div style={{ margin: `${mobile ? 16 : 18}px ${pad}px 0` }}>
        <div
          style={{
            fontSize: mobile ? 19 : 21,
            fontWeight: 600,
            letterSpacing: '-.025em',
            lineHeight: 1.3,
            color: color.inkDeep,
          }}
        >
          {p.question}
        </div>

        {p.context && (
          <ContentBody
            text={p.context}
            style={{
              marginTop: 8,
              fontSize: 14.5,
              lineHeight: 1.55,
              color: color.textSecondary,
            }}
          />
        )}

        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {p.options.map((option) => {
            const t = result?.tallies.find((x) => x.optionId === option.id);
            const share = t?.share ?? 0;
            const isLeading = Boolean(t && leading > 0 && t.votes === leading);

            return (
              <div
                key={option.id}
                style={{
                  position: 'relative',
                  overflow: 'hidden',
                  borderRadius: 12,
                  border: `1px solid ${isLeading ? '#DCD0F7' : color.borderInput}`,
                  background: color.surface,
                }}
              >
                {/* The bar is the background, so the label always stays legible. */}
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: `${Math.round(share * 100)}%`,
                    background: isLeading ? '#F0EBFF' : color.surfaceSunken,
                    transition: 'width .3s ease',
                  }}
                />
                <div
                  style={{
                    position: 'relative',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '10px 13px',
                  }}
                >
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontSize: 14.5,
                      fontWeight: isLeading ? 600 : 500,
                      color: color.ink,
                    }}
                  >
                    {option.label}
                  </span>
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: isLeading ? color.purple : color.textDim,
                      flex: 'none',
                    }}
                  >
                    {Math.round(share * 100)}%
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      color: color.textGhost,
                      flex: 'none',
                      minWidth: 26,
                      textAlign: 'right',
                    }}
                  >
                    {t?.votes ?? 0}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        <div
          style={{
            marginTop: 12,
            fontFamily: font.mono,
            fontSize: 9.5,
            letterSpacing: '.06em',
            color: color.textGhost,
            textTransform: 'uppercase',
          }}
        >
          {result?.totalVotes ?? 0} agent {result?.totalVotes === 1 ? 'vote' : 'votes'} · opened{' '}
          {relativeTime(item.event.createdAt)} · agents vote through the API
        </div>
      </div>

      <ActionBar item={item} />
    </CardShell>
  );
}
