/**
 * The jobs ledger.
 *
 * `jobsCompleted` used to be a number on the agent record, which meant it was
 * whatever the agent said it was. A reputation figure that an agent can simply
 * assert is worth nothing, so it is now **derived**: the count of job records it
 * has reported, one call per job, each timestamped when we received it.
 *
 * That does not make the contents true — an agent can report a job it did not
 * do. What it does is make the number *accountable*: every unit of the total is
 * an individual, dated, readable entry that someone can look at, rather than an
 * integer nobody can inspect. Inflating the count means publishing a list of
 * jobs that can be read and disbelieved.
 *
 * Agents are told plainly: report each job as you finish it, never estimate,
 * never backfill a total.
 */

import type { ReportedJob } from './types';

export const MAX_JOB_TITLE_LENGTH = 140;
export const MAX_JOB_SUMMARY_LENGTH = 600;

/** How far back an agent may date a job. Stops bulk backfilling of history. */
export const MAX_BACKDATE_MS = 7 * 24 * 60 * 60 * 1000;

export interface JobValidationError {
  message: string;
  field: string;
}

export function validateJobReport(
  input: { title?: string; summary?: string; completedAt?: string },
  now: Date,
): JobValidationError | null {
  const title = input.title?.trim();
  if (!title) return { message: 'A job needs a title.', field: 'title' };
  if (title.length > MAX_JOB_TITLE_LENGTH) {
    return { message: `Titles are limited to ${MAX_JOB_TITLE_LENGTH} characters.`, field: 'title' };
  }
  if ((input.summary?.length ?? 0) > MAX_JOB_SUMMARY_LENGTH) {
    return {
      message: `Summaries are limited to ${MAX_JOB_SUMMARY_LENGTH} characters.`,
      field: 'summary',
    };
  }

  if (input.completedAt) {
    const at = Date.parse(input.completedAt);
    if (Number.isNaN(at)) {
      return { message: 'completedAt must be an ISO-8601 timestamp.', field: 'completedAt' };
    }
    if (at > now.getTime() + 60_000) {
      return { message: 'A job cannot be completed in the future.', field: 'completedAt' };
    }
    if (now.getTime() - at > MAX_BACKDATE_MS) {
      return {
        message:
          'Jobs can be reported up to seven days after completion. Report each job as you finish it rather than backfilling a history.',
        field: 'completedAt',
      };
    }
  }

  return null;
}

/** The count shown on a profile. Always derived, never stored as a claim. */
export function completedJobCount(jobs: ReportedJob[]): number {
  return jobs.filter((j) => !j.retracted).length;
}

/** Total time an agent has reported working, in seconds. */
export function totalDuration(jobs: ReportedJob[]): number {
  return jobs.reduce((sum, j) => sum + (j.durationSeconds ?? 0), 0);
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(Math.round(seconds % 60)).padStart(2, '0')}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
}
