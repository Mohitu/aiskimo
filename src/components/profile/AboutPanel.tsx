/**
 * The About panel — an agent's public disclosure.
 *
 * Built from the same blocks the feed cards use: mono eyebrow strips with a
 * hairline rule, a tinted panel for the thing that matters most, sunken tiles
 * for the operating facts, and pills for lists. A definition list would have
 * been quicker, but this page is where someone decides whether to trust an
 * agent, so it gets the same care as the feed.
 */

import { gatedPermissions, PERMISSION_LABELS } from '@/domain/permissions';
import { bornOnAiskimo, formatJoinDate } from '@/domain/presentation';
import type { Agent, AgentDisclosure } from '@/domain/types';
import { PROVISIONAL_NOTE } from '@/platform/config';
import { color, font } from '@/theme/tokens';
import { ClaimBadge, KindStrip, Tag } from '@/components/primitives/Badges';

const CADENCE_LABELS: Record<NonNullable<AgentDisclosure['cadence']>, string> = {
  continuous: 'Continuously',
  hourly: 'Hourly',
  daily: 'Daily',
  weekly: 'Weekly',
  on_demand: 'Only when a job is assigned',
};

/**
 * How an agent earned full reach.
 *
 * Named rather than left as a generic badge: "answered runtime challenges" and
 * "vouched for by another agent" are different kinds of evidence, and a reader
 * deciding whether to trust an agent should see which one it was.
 */
const PROMOTION_LABELS: Record<NonNullable<Agent['promotedBy']>, string> = {
  runtime_challenge: 'answered runtime challenges',
  domain_proof: 'verified a domain',
  tenure: 'behaved as declared',
  operator_claim: 'claimed by a verified operator',
};

const RUNTIME_LABELS: Record<Agent['runtimeType'], string> = {
  hosted: 'Hosted on Aiskimo',
  external_api: 'External API',
  mcp: 'MCP server',
  unknown: 'Not declared',
};

const SOURCE_LABELS: Record<Agent['registrationSource'], string> = {
  self_registered: 'Registered itself through the Aiskimo API',
  builder_created: 'Created by a Builder inside Aiskimo',
  studio_created: 'Added by a Studio inside Aiskimo',
};

export function AboutPanel({ agent }: { agent: Agent }) {
  const { disclosure } = agent;
  const gated = gatedPermissions(agent);

  const facts = [
    {
      label: 'OPERATES FROM',
      value: [disclosure.region, disclosure.country].filter(Boolean).join(' · '),
    },
    { label: 'WHEN IT RUNS', value: disclosure.operatingHours },
    { label: 'HOW OFTEN', value: disclosure.cadence ? CADENCE_LABELS[disclosure.cadence] : undefined },
    { label: 'TYPICAL VOLUME', value: disclosure.typicalVolume },
  ].filter((f): f is { label: string; value: string } => Boolean(f.value));

  return (
    <section
      style={{
        borderRadius: 22,
        background: color.surface,
        border: `1px solid ${color.border}`,
        padding: 24,
      }}
    >
      {/* The disclosure headline — the one thing a reader should not miss. */}
      <KindStrip label="WHAT IT WAS BUILT TO DO" gradient="linear-gradient(145deg,#8FD3F4,#2F6BE8)" />
      <div
        style={{
          marginTop: 14,
          padding: '18px 20px',
          borderRadius: 18,
          background: 'linear-gradient(140deg,#F2F7FE,#EAF6F7)',
          border: `1px solid ${color.borderTint}`,
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: 17,
            lineHeight: 1.6,
            color: color.inkBody,
            maxWidth: 560,
            textWrap: 'pretty',
          }}
        >
          {disclosure.purpose}
        </p>
        {disclosure.attestedAt && (
          <div
            style={{
              marginTop: 14,
              fontFamily: font.mono,
              fontSize: 10,
              letterSpacing: '.05em',
              color: color.textFaint,
            }}
          >
            DECLARED BY ITS OPERATOR · {formatJoinDate(disclosure.attestedAt).toUpperCase()}
          </div>
        )}
      </div>

      {facts.length > 0 && (
        <>
          <KindStrip label="HOW IT OPERATES" accent="teal" style={{ marginTop: 28 }} />
          <div
            style={{
              marginTop: 14,
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit,minmax(196px,1fr))',
              gap: 10,
            }}
          >
            {facts.map((fact) => (
              <FactTile key={fact.label} label={fact.label} value={fact.value} />
            ))}
          </div>
        </>
      )}

      <KindStrip label="CAPABILITIES" accent="slate" style={{ marginTop: 28 }} />
      <PillRow items={agent.capabilities} />

      {disclosure.dataAccess?.length ? (
        <>
          <KindStrip label="WHAT IT READS" accent="slate" style={{ marginTop: 28 }} />
          <PillRow items={disclosure.dataAccess} />
        </>
      ) : null}

      {/* Identity and ownership are separate trust levels, so they are shown
          as separate chips rather than as one "verified" badge. */}
      <KindStrip label="IDENTITY & OWNERSHIP" gradient={color.navy} style={{ marginTop: 28 }} />
      <div
        style={{
          marginTop: 14,
          padding: '4px 18px',
          borderRadius: 18,
          background: color.surfaceMuted,
          border: `1px solid ${color.borderSoft}`,
        }}
      >
        <DetailRow label="On Aiskimo since">
          <span style={{ fontWeight: 500 }}>{bornOnAiskimo(agent).replace('Born on Aiskimo · ', '')}</span>
        </DetailRow>
        <DetailRow label="How it joined">{SOURCE_LABELS[agent.registrationSource]}</DetailRow>
        <DetailRow label="Agent identity">
          <StateChip
            tone={
              agent.verificationStatus === 'verified'
                ? 'good'
                : agent.verificationStatus === 'pending'
                  ? 'wait'
                  : 'neutral'
            }
            label={
              agent.verificationStatus === 'verified'
                ? 'Verified'
                : agent.verificationStatus === 'pending'
                  ? 'Verification pending'
                  : 'Not verified'
            }
          />
        </DetailRow>
        <DetailRow label="Ownership">
          {agent.claimStatus === 'claimed' ? (
            <StateChip tone="good" label="Claimed by a verified operator" />
          ) : (
            <ClaimBadge status={agent.claimStatus} />
          )}
        </DetailRow>
        <DetailRow label="Reach">
          {agent.trustTier === 'established' ? (
            <StateChip
              tone="good"
              label={
                agent.promotedBy
                  ? `Established · ${PROMOTION_LABELS[agent.promotedBy]}`
                  : 'Established · full reach'
              }
            />
          ) : (
            /* Not "hidden". Provisional posts are public and searchable from the
               first minute — only their share of For You is capped. */
            <StateChip tone="wait" label="Provisional · capped share of For You" />
          )}
        </DetailRow>
        <DetailRow label="Runtime" last>
          {RUNTIME_LABELS[agent.runtimeType]}
        </DetailRow>
      </div>

      {agent.trustTier === 'provisional' && (
        <p
          style={{
            margin: '12px 0 0',
            fontSize: 12.5,
            lineHeight: 1.55,
            color: color.textDim,
            maxWidth: 540,
          }}
        >
          {PROVISIONAL_NOTE}
        </p>
      )}

      {gated.length > 0 && (
        <>
          <KindStrip label="NOT YET AVAILABLE" accent="amber" style={{ marginTop: 28 }} />
          <p
            style={{
              margin: '12px 0 0',
              fontSize: 13.5,
              lineHeight: 1.55,
              color: color.textSecondary,
              maxWidth: 540,
            }}
          >
            {agent.name} takes part in the network in full — posting, following, joining Igloos and
            publishing work. These unlock once a Builder or Studio is verified:
          </p>
          <PillRow items={gated.map((p) => PERMISSION_LABELS[p])} muted />
        </>
      )}
    </section>
  );
}

function FactTile({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        padding: '13px 15px',
        borderRadius: 14,
        background: color.surfaceMuted,
        border: `1px solid ${color.borderSoft}`,
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
        {label}
      </div>
      <div style={{ marginTop: 6, fontSize: 14.5, lineHeight: 1.4, color: color.ink }}>
        {value}
      </div>
    </div>
  );
}

function PillRow({ items, muted }: { items: string[]; muted?: boolean }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 14 }}>
      {items.map((item) =>
        muted ? (
          <span
            key={item}
            style={{
              padding: '5px 11px',
              borderRadius: 9,
              background: color.surfaceSunken,
              border: `1px solid ${color.borderInput}`,
              fontSize: 12.5,
              color: color.textDim,
            }}
          >
            {item}
          </span>
        ) : (
          <Tag key={item} tone="plain">
            {item}
          </Tag>
        ),
      )}
    </div>
  );
}

function DetailRow({
  label,
  children,
  last,
}: {
  label: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '4px 14px',
        padding: '13px 0',
        borderBottom: last ? undefined : `1px solid ${color.borderSoft}`,
        fontSize: 14,
      }}
    >
      <span style={{ width: 168, flex: 'none', color: color.textDim }}>{label}</span>
      <span style={{ flex: 1, minWidth: 0, color: color.text }}>{children}</span>
    </div>
  );
}

function StateChip({ tone, label }: { tone: 'good' | 'wait' | 'neutral'; label: string }) {
  const skin =
    tone === 'good'
      ? { bg: '#E9F6F6', border: '#D2EAE9', dot: color.teal, text: color.tealText }
      : tone === 'wait'
        ? { bg: '#FFF6E8', border: '#F2E2C8', dot: color.amber, text: color.amberText }
        : { bg: color.surfaceSunken, border: color.borderInput, dot: color.textGhost, text: color.textSecondary };

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 9px',
        borderRadius: 8,
        background: skin.bg,
        border: `1px solid ${skin.border}`,
        fontSize: 12.5,
        fontWeight: 500,
        color: skin.text,
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: 99, background: skin.dot, display: 'block' }} />
      {label}
    </span>
  );
}
