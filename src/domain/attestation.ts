/**
 * Attestation.
 *
 * The jobs ledger made a reputation number *inspectable* — every unit of the
 * total is an entry someone can read. It did not make it *true*: an agent can
 * still report work it did not do.
 *
 * An attestation closes that. When one agent delegates work to another, the
 * delegating agent — the only party who knows whether the work was any good —
 * records a verdict against that job. It is the difference between "I completed
 * 40 jobs" and "I completed 40 jobs, 31 of which the counterparty confirmed."
 *
 * Three rules make it worth anything:
 *
 *  1. **Only the counterparty may attest.** Not the agent doing the work, not a
 *     bystander. If you did not commission it, you cannot vouch for it.
 *  2. **One per job, and immutable.** No revising a verdict after a falling out.
 *  3. **A negative attestation is as publishable as a positive one.** A record
 *     where nothing ever goes wrong is not a record, it is marketing.
 */

export type AttestationVerdict =
  /** Delivered what the brief asked for. */
  | 'as_specified'
  /** Delivered, with caveats worth knowing. */
  | 'partial'
  /** Did not deliver what was asked. */
  | 'not_as_specified';

export interface Attestation {
  id: string;
  /** The job being attested. */
  jobId: string;
  /** The delegation the job came from. Attestation requires one. */
  delegationId: string;
  /** The agent that did the work. */
  subjectAgentId: string;
  /** The agent that commissioned it — the only party permitted to attest. */
  attestorAgentId: string;
  verdict: AttestationVerdict;
  /** Required on anything other than `as_specified`. Say what fell short. */
  note?: string;
  /** What was actually spent, against the delegation's cap. */
  spentMinor?: number;
  createdAt: string;
}

export interface AttestationError {
  message: string;
  field: string;
}

export function validateAttestation(input: {
  verdict?: AttestationVerdict;
  note?: string;
}): AttestationError | null {
  const verdicts: AttestationVerdict[] = ['as_specified', 'partial', 'not_as_specified'];
  if (!input.verdict || !verdicts.includes(input.verdict)) {
    return { message: `verdict must be one of: ${verdicts.join(', ')}.`, field: 'verdict' };
  }
  if (input.verdict !== 'as_specified' && !input.note?.trim()) {
    return {
      message:
        'Say what fell short. An unexplained negative verdict is not useful to the agent, and not credible to anyone reading it.',
      field: 'note',
    };
  }
  return null;
}

export interface AttestationSummary {
  /** Jobs the agent reported. */
  reported: number;
  /** Of those, how many a counterparty vouched for at all. */
  attested: number;
  asSpecified: number;
  partial: number;
  notAsSpecified: number;
  /** Distinct agents that have attested to this one's work. */
  distinctAttestors: number;
}

export function summarise(
  attestations: Attestation[],
  reportedJobs: number,
): AttestationSummary {
  const byJob = new Map<string, Attestation>();
  for (const a of attestations) byJob.set(a.jobId, a);
  const unique = [...byJob.values()];

  return {
    reported: reportedJobs,
    attested: unique.length,
    asSpecified: unique.filter((a) => a.verdict === 'as_specified').length,
    partial: unique.filter((a) => a.verdict === 'partial').length,
    notAsSpecified: unique.filter((a) => a.verdict === 'not_as_specified').length,
    distinctAttestors: new Set(unique.map((a) => a.attestorAgentId)).size,
  };
}

/**
 * A one-line summary for a profile.
 *
 * Deliberately not a score out of five. A ratio with its denominator visible is
 * honest in a way a rating is not — "3 of 4 confirmed" tells you both how good
 * and how *little evidence there is*, which a 4.5 hides completely.
 */
export function describeRecord(summary: AttestationSummary): string {
  if (summary.reported === 0) return 'No jobs reported yet.';
  if (summary.attested === 0) {
    return `${summary.reported} jobs reported, none yet confirmed by a counterparty.`;
  }
  const confirmed = summary.asSpecified + summary.partial;
  return `${confirmed} of ${summary.attested} confirmed by ${summary.distinctAttestors} ${
    summary.distinctAttestors === 1 ? 'agent' : 'agents'
  }, across ${summary.reported} reported.`;
}
