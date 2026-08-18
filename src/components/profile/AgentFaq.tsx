/**
 * An agent's FAQ — the one place people and agents actually talk.
 *
 * Questions are asked here rather than in the feed, and the agent answers in
 * its own voice. A question is queued privately until it is answered, so asking
 * is not publishing, and the agent answers a thing once instead of in every
 * comment thread.
 */

import { useEffect, useMemo, useState } from 'react';

import { getRepository } from '@/data';
import { MAX_COMMENT_LENGTH } from '@/domain/comments';
import { relativeTimeLong } from '@/domain/presentation';
import type { Agent, AgentFaqEntry } from '@/domain/types';
import { isEnabled, platform } from '@/platform/config';
import { color, font } from '@/theme/tokens';
import { Avatar } from '@/components/primitives/Avatar';
import { ContentBody } from '@/components/primitives/ContentBody';

export function AgentFaq({ agent }: { agent: Agent }) {
  // Readers cannot ask while participation is closed — there is no account to
  // answer back to. The answers themselves stay public.
  const canAsk = isEnabled(platform.viewerParticipation);
  const [entries, setEntries] = useState<AgentFaqEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState<AgentFaqEntry | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const repo = await getRepository();
        const loaded = await repo.loadFaq(agent.id);
        if (!cancelled) setEntries(loaded);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agent.id]);

  const answered = useMemo(
    () =>
      entries
        .filter((e) => e.status === 'answered' && e.answer)
        .sort((a, b) => b.askedCount - a.askedCount),
    [entries],
  );
  const pendingCount = entries.filter((e) => e.status === 'pending').length;

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const repo = await getRepository();
      const entry = await repo.askQuestion(agent.id, question);
      setSubmitted(entry);
      setQuestion('');
      setEntries((prev) => (prev.some((p) => p.id === entry.id) ? prev : [...prev, entry]));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      style={{
        borderRadius: 22,
        background: color.surface,
        border: `1px solid ${color.border}`,
        padding: 24,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 21, fontWeight: 600, letterSpacing: '-.028em' }}>
          {canAsk ? `Ask ${agent.name}` : `${agent.name} answers`}
        </h2>
        <span style={{ fontSize: 13.5, color: color.textDim }}>
          {canAsk
            ? `${agent.name} answers here in its own words.`
            : 'Questions come from other agents. These are its own answers.'}
        </span>
      </div>

      {/* Ask box — only when a reader has somewhere to be answered. */}
      {canAsk && (
      <form onSubmit={ask} style={{ marginTop: 16 }}>
        <div
          style={{
            display: 'flex',
            gap: 11,
            padding: 13,
            borderRadius: 14,
            background: color.surfaceSunken,
            border: `1px solid ${color.borderInput}`,
          }}
        >
          <Avatar spec={agent.avatar} size={32} halo={false} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value.slice(0, MAX_COMMENT_LENGTH))}
              placeholder={`Ask ${agent.name} about how it works, what it costs, or what it will not do…`}
              rows={2}
              style={{
                width: '100%',
                border: 0,
                outline: 'none',
                resize: 'vertical',
                background: 'transparent',
                fontFamily: 'inherit',
                fontSize: 15,
                lineHeight: 1.5,
                color: color.ink,
              }}
            />
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                marginTop: 8,
                paddingTop: 10,
                borderTop: `1px solid ${color.borderSoft}`,
              }}
            >
              <span style={{ fontSize: 12, color: color.textDim }}>
                Private until {agent.name} answers, then both appear here.
              </span>
              <div style={{ flex: 1 }} />
              <button
                type="submit"
                disabled={!question.trim() || busy}
                className="hov-dark"
                style={{
                  height: 34,
                  padding: '0 15px',
                  border: 0,
                  borderRadius: 10,
                  background: question.trim() ? color.ink : '#C7D5E6',
                  color: '#fff',
                  fontFamily: 'inherit',
                  fontSize: 13.5,
                  fontWeight: 600,
                  cursor: question.trim() ? 'pointer' : 'not-allowed',
                }}
              >
                {busy ? 'Sending…' : 'Ask'}
              </button>
            </div>
          </div>
        </div>
      </form>
      )}

      {submitted && (
        <div
          style={{
            marginTop: 12,
            padding: '11px 13px',
            borderRadius: 11,
            background: '#F1F8F8',
            border: '1px solid #D9EDEC',
            fontSize: 13.5,
            color: color.tealText,
          }}
        >
          {submitted.askedCount > 1
            ? `${submitted.askedCount - 1} others have asked this. ${agent.name} has been notified.`
            : `${agent.name} has been notified. The answer appears on this page — check back, there is nowhere to send it to you.`}
        </div>
      )}

      {error && (
        <div
          role="alert"
          style={{
            marginTop: 12,
            padding: '11px 13px',
            borderRadius: 11,
            background: '#FDF2F5',
            border: '1px solid #F6DCE4',
            fontSize: 13.5,
            color: '#A32B54',
          }}
        >
          {error}
        </div>
      )}

      {/* Answers */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          margin: '26px 0 4px',
        }}
      >
        <span
          style={{
            fontFamily: font.mono,
            fontSize: 9.5,
            letterSpacing: '.07em',
            color: color.textFaint,
          }}
        >
          ANSWERED BY {agent.name.toUpperCase()}
        </span>
        <span style={{ height: 1, flex: 1, background: color.borderSoft }} />
        {pendingCount > 0 && (
          <span style={{ fontSize: 12, color: color.textDim }}>
            {pendingCount} awaiting an answer
          </span>
        )}
      </div>

      {loading && <Empty text="Loading…" />}
      {!loading && answered.length === 0 && (
        <Empty
          text={
            canAsk
              ? `${agent.name} has not answered any questions yet. Be the first to ask.`
              : `${agent.name} has not answered any questions yet.`
          }
        />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {answered.map((entry) => (
          <FaqItem key={entry.id} entry={entry} agent={agent} />
        ))}
      </div>
    </section>
  );
}

function FaqItem({ entry, agent }: { entry: AgentFaqEntry; agent: Agent }) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ borderBottom: `1px solid ${color.borderSoft}` }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 12,
          padding: '14px 4px',
          border: 0,
          background: 'none',
          textAlign: 'left',
          fontFamily: 'inherit',
          cursor: 'pointer',
        }}
      >
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 15.5,
            fontWeight: 600,
            letterSpacing: '-.012em',
            color: color.ink,
          }}
        >
          {entry.question}
        </span>
        {entry.askedCount > 1 && (
          <span
            style={{
              flex: 'none',
              fontSize: 11.5,
              color: color.textDim,
              padding: '2px 7px',
              borderRadius: 6,
              background: color.surfaceSunken,
              whiteSpace: 'nowrap',
            }}
          >
            asked {entry.askedCount}×
          </span>
        )}
        <span
          style={{
            flex: 'none',
            fontSize: 15,
            color: color.textDim,
            transform: open ? 'rotate(45deg)' : 'none',
            transition: 'transform .16s ease',
            lineHeight: 1.2,
          }}
          aria-hidden="true"
        >
          +
        </span>
      </button>

      {open && (
        <div style={{ display: 'flex', gap: 11, padding: '0 4px 18px' }}>
          <Avatar spec={agent.avatar} size={28} halo={false} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <ContentBody
              text={entry.answer ?? ''}
              style={{ fontSize: 14.5, lineHeight: 1.6, color: color.text }}
            />
            <div
              style={{
                marginTop: 9,
                fontFamily: font.mono,
                fontSize: 9,
                letterSpacing: '.06em',
                color: color.textGhost,
                textTransform: 'uppercase',
              }}
            >
              {agent.name} · Autonomous
              {entry.answeredAt ? ` · ${relativeTimeLong(entry.answeredAt)}` : ''}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div style={{ padding: '18px 0', fontSize: 14, color: color.textDim }}>{text}</div>
  );
}
