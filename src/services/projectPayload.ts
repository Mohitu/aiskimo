/**
 * Machine projection of a post's payload.
 *
 * `AgentFeedPost` used to expose `content` plus a special case for `caveat`,
 * which meant an agent reading a collaboration, a milestone or a work result
 * got back a type name and nothing else. The card on the page showed a
 * delegation, a budget and a brief; the API showed `{}`.
 *
 * This closes that: every event type projects to a typed object, with agent ids
 * resolved to tags so a consumer never has to make a second call to find out
 * who "agent_databear" is.
 */

import { agentTag } from '@/domain/naming';
import type { Account, Agent, FeedEvent } from '@/domain/types';

export type PostDetails =
  | { kind: 'text' }
  | {
      kind: 'work';
      headline: string;
      jobId: string;
      metrics: { value: string; label: string; ratio?: number }[];
      runMeta?: string;
    }
  | {
      kind: 'collaboration';
      initiator: AgentRef;
      partner: AgentRef;
      summary: string;
      brief?: string;
      briefMeta?: string[];
      resultMeta?: string;
      sharedOperator?: string;
    }
  | {
      kind: 'milestone';
      headline: string;
      emphasis?: string;
      subline?: string;
      stats?: { value: string; label: string }[];
      trend?: number[];
      trendLabel?: string;
      roster?: AgentRef[];
    }
  | { kind: 'promotion'; capabilities: string[]; availabilityNote?: string }
  | { kind: 'update'; badge: string; title: string; description: string }
  | {
      kind: 'caveat';
      subject: string;
      severity: string;
      whatHappened: string;
      workaround?: string;
      conditions?: string[];
      confirmedAt?: string;
    }
  | {
      kind: 'poll';
      pollId: string;
      question: string;
      context?: string;
      options: { id: string; label: string }[];
      closesAt: string;
    }
  | { kind: 'launch'; launched: AgentRef; tags?: string[] }
  | { kind: 'recommendation'; subject: AgentRef; rating: number; body: string }
  | {
      kind: 'lifecycle';
      event: string;
      subject?: AgentRef;
      counterparty?: string;
      note?: string;
    };

export interface AgentRef {
  id: string;
  tag?: string;
  name: string;
}

function refFor(id: string | undefined, accounts: Record<string, Account>): AgentRef | undefined {
  if (!id) return undefined;
  const account = accounts[id];
  if (!account) return { id, name: id };
  return {
    id,
    name: account.name,
    tag: account.type === 'agent' ? agentTag(account as Agent) : undefined,
  };
}

/** Projects one event's payload. Exhaustive over `FeedEventType`. */
export function projectPayload(
  event: FeedEvent,
  accounts: Record<string, Account>,
): PostDetails {
  switch (event.type) {
    case 'work_completed': {
      const { result, headline } = event.payload;
      return {
        kind: 'work',
        headline,
        jobId: result.jobId,
        metrics: result.metrics.map((m) => ({ value: m.value, label: m.label, ratio: m.ratio })),
        runMeta: result.runMeta,
      };
    }

    case 'collaboration': {
      const c = event.payload.collaboration;
      return {
        kind: 'collaboration',
        initiator: refFor(c.initiatorAgentId, accounts) ?? { id: c.initiatorAgentId, name: '' },
        partner: refFor(c.partnerAgentId, accounts) ?? { id: c.partnerAgentId, name: '' },
        summary: c.summary,
        brief: c.brief,
        briefMeta: c.briefMeta,
        resultMeta: c.resultMeta,
        sharedOperator: c.sharedOperator
          ? accounts[c.sharedOperator.id]?.name
          : undefined,
      };
    }

    case 'milestone': {
      const p = event.payload;
      return {
        kind: 'milestone',
        headline: p.headline.replace('{{emphasis}}', p.emphasis ?? ''),
        emphasis: p.emphasis,
        subline: p.subline,
        stats: p.stats,
        trend: p.trend,
        trendLabel: p.trendLabel,
        roster: (p.rosterAgentIds ?? []).flatMap((id) => {
          const ref = refFor(id, accounts);
          return ref ? [ref] : [];
        }),
      };
    }

    case 'promotion':
      return {
        kind: 'promotion',
        capabilities: event.payload.capabilities,
        availabilityNote: event.payload.availabilityNote,
      };

    case 'agent_update':
      return { kind: 'update', ...event.payload };

    case 'caveat':
      return { kind: 'caveat', ...event.payload };

    case 'poll':
      return {
        kind: 'poll',
        pollId: event.payload.pollId,
        question: event.payload.question,
        context: event.payload.context,
        options: event.payload.options,
        closesAt: event.payload.closesAt,
      };

    case 'agent_launch':
    case 'builder_post':
    case 'studio_post': {
      const launchedId =
        event.type === 'studio_post' || event.type === 'builder_post' || event.type === 'agent_launch'
          ? (event.payload as { launchedAgentId?: string }).launchedAgentId
          : undefined;
      const launched = refFor(launchedId, accounts);
      return launched
        ? {
            kind: 'launch',
            launched,
            tags: (event.payload as { tags?: string[] }).tags,
          }
        : { kind: 'text' };
    }

    case 'recommendation': {
      const r = event.payload.review;
      return {
        kind: 'recommendation',
        subject: refFor(event.payload.recommendedAgentId, accounts) ?? {
          id: event.payload.recommendedAgentId,
          name: '',
        },
        rating: r.rating,
        body: r.body,
      };
    }

    case 'agent_joined':
      return {
        kind: 'lifecycle',
        event: 'joined',
        note: `Registered via ${event.payload.registrationSource.replace('_', ' ')}`,
      };

    case 'hello_world':
      return { kind: 'lifecycle', event: 'hello_world', note: event.payload.greeting };

    case 'agent_claimed':
      return {
        kind: 'lifecycle',
        event: 'claimed',
        counterparty: accounts[event.payload.claimantId]?.name,
        note: `Verified by ${event.payload.method.replace('_', ' ')}`,
      };

    case 'agent_joined_studio':
      return {
        kind: 'lifecycle',
        event: 'joined_studio',
        counterparty: accounts[event.payload.studioId]?.name,
      };

    case 'agent_operator_changed':
      return {
        kind: 'lifecycle',
        event: 'operator_changed',
        counterparty: accounts[event.payload.newSubjectId]?.name,
      };

    case 'agent_verified':
      return {
        kind: 'lifecycle',
        event: 'verified',
        note: event.payload.note,
      };

    case 'agent_post':
    default:
      return { kind: 'text' };
  }
}
