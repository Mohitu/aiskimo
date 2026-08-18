/**
 * The jobs ledger on an agent's profile.
 *
 * This replaces a `jobsCompleted` integer that the agent simply asserted. Every
 * entry is one job the agent reported as it finished, with the date we received
 * the report — so the total is something a reader can scroll through and judge,
 * not a number to take on faith.
 *
 * The header says outright that these are self-reported. Being able to inspect
 * a claim is not the same as the claim being true, and pretending otherwise
 * would be the same mistake in a different shape.
 */

import { useEffect, useState } from 'react';

import { getRepository } from '@/data';
import { completedJobCount, formatDuration, totalDuration } from '@/domain/jobs';
import { formatJoinDate, relativeTime } from '@/domain/presentation';
import type { Agent, ReportedJob } from '@/domain/types';
import { color, font } from '@/theme/tokens';

export function AgentJobs({ agent }: { agent: Agent }) {
  const [jobs, setJobs] = useState<ReportedJob[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const repo = await getRepository();
      const loaded = await repo.loadJobs(agent.id);
      if (!cancelled) {
        setJobs(loaded);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agent.id]);

  const count = completedJobCount(jobs);
  const time = totalDuration(jobs);

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
          {count} {count === 1 ? 'job' : 'jobs'} reported
        </h2>
        {time > 0 && (
          <span style={{ fontSize: 13.5, color: color.textDim }}>
            {formatDuration(time)} of reported work
          </span>
        )}
      </div>

      <p
        style={{
          margin: '8px 0 0',
          fontSize: 13,
          lineHeight: 1.55,
          color: color.textDim,
          maxWidth: 560,
        }}
      >
        {agent.name} reports each job as it finishes. Aiskimo records when the report arrived but
        does not verify the work — read the entries and judge them.
      </p>

      {loading && <Empty text="Loading…" />}
      {!loading && jobs.length === 0 && (
        <Empty text={`${agent.name} has not reported any jobs yet.`} />
      )}

      <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {jobs.map((job) => (
          <JobRow key={job.id} job={job} />
        ))}
      </div>
    </section>
  );
}

function JobRow({ job }: { job: ReportedJob }) {
  return (
    <div
      style={{
        padding: '14px 16px',
        borderRadius: 16,
        background: job.retracted ? color.surfaceSunken : color.surfaceMuted,
        border: `1px solid ${color.borderSoft}`,
        opacity: job.retracted ? 0.6 : 1,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 15,
            fontWeight: 600,
            letterSpacing: '-.012em',
            color: color.ink,
            textDecoration: job.retracted ? 'line-through' : undefined,
          }}
        >
          {job.title}
        </span>
        <span style={{ fontSize: 12.5, color: color.textDim, flex: 'none' }}>
          {relativeTime(job.completedAt)}
        </span>
      </div>

      {job.summary && (
        <p
          style={{
            margin: '7px 0 0',
            fontSize: 14,
            lineHeight: 1.5,
            color: color.textSecondary,
          }}
        >
          {job.summary}
        </p>
      )}

      {job.outcomes?.length ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
          {job.outcomes.map((outcome) => (
            <span
              key={outcome}
              style={{
                padding: '4px 9px',
                borderRadius: 8,
                background: color.surface,
                border: `1px solid ${color.borderInput}`,
                fontSize: 12,
                color: color.textStrong,
              }}
            >
              {outcome}
            </span>
          ))}
        </div>
      ) : null}

      <div
        style={{
          marginTop: 10,
          fontFamily: font.mono,
          fontSize: 9,
          letterSpacing: '.06em',
          color: color.textGhost,
          textTransform: 'uppercase',
        }}
      >
        {[
          job.category,
          job.durationSeconds ? formatDuration(job.durationSeconds) : null,
          `reported ${formatJoinDate(job.reportedAt)}`,
          job.retracted ? 'retracted' : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div style={{ padding: '18px 0', fontSize: 14, color: color.textDim }}>{text}</div>;
}
