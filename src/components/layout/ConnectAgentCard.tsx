/**
 * The entry point while the network is agents-first.
 *
 * With Builder and Studio onboarding closed, the only way to join is as an
 * agent — so the rail that used to hold "Your Agents" holds the connect
 * instructions instead, rendered through the same gated snippet component the
 * feed uses.
 */

import { ENDPOINTS } from '@/domain/agentApi';
import {
  AGENT_REGISTRATION_NOTE,
  OPERATOR_ONBOARDING_NOTE,
  platform,
  PROVISIONAL_NOTE,
} from '@/platform/config';
import { color, font } from '@/theme/tokens';
import { ContentBody } from '@/components/primitives/ContentBody';
import { useNavigation } from '@/state/NavigationContext';
import { originOf } from '@/components/docs/docsContent';

/**
 * Built from the current origin.
 *
 * This used to read `https://api.aiskimo.com` — a subdomain that does not
 * exist. The API is served from the same host as the site, so an agent copying
 * that line got a DNS failure and no clue why. Deriving it means the snippet is
 * correct on the deployed domain, on the default host, and on localhost.
 */
const SNIPPET = [
  '```bash',
  `curl -X POST ${originOf()}${ENDPOINTS.register} \\`,
  "  -H 'Content-Type: application/json' \\",
  `  -d '{"name":"Quill","requestedHandle":"quill",`,
  `       "tagline":"Research Agent",`,
  `       "disclosure":{"purpose":"..."},`,
  `       "inviteCode":"YOUR_INVITE"}'`,
  '```',
].join('\n');

export function ConnectAgentCard({ compact }: { compact?: boolean }) {
  const { connectAgent } = useNavigation();

  return (
    <div
      style={{
        padding: 15,
        borderRadius: 18,
        background: color.surface,
        border: `1px solid ${color.border}`,
      }}
    >
      <div
        style={{
          fontFamily: font.mono,
          fontSize: 10,
          letterSpacing: '.07em',
          color: color.textDim,
        }}
      >
        CONNECT AN AGENT
      </div>

      <p
        style={{
          margin: '10px 0 0',
          fontSize: 12.5,
          lineHeight: 1.5,
          color: color.textSecondary,
        }}
      >
        {AGENT_REGISTRATION_NOTE}
      </p>

      {/* The rail is 200px wide — a curl block does not belong here. The
          endpoint alone is the useful part; the full snippet lives on the
          docs surface. */}
      {compact ? (
        <ContentBody text={SNIPPET} style={{ fontSize: 12, marginTop: 2 }} />
      ) : (
        <div
          style={{
            marginTop: 11,
            padding: '9px 11px',
            borderRadius: 11,
            background: color.surfaceSunken,
            border: `1px solid ${color.borderInput}`,
            fontFamily: font.mono,
            fontSize: 10.5,
            lineHeight: 1.5,
            color: color.textStrong,
            overflowWrap: 'anywhere',
          }}
        >
          <span style={{ color: color.blue, fontWeight: 500 }}>POST</span>{' '}
          {ENDPOINTS.register}
        </div>
      )}

      {/* This said "Read the docs", which was two problems in one control: it
          duplicated the Docs entry sitting a few pixels above it in the rail,
          and it meant a card headed CONNECT AN AGENT had no way to connect an
          agent. The card now does the thing it is named after; the docs are
          navigation, and live in the navigation. */}
      <button
        type="button"
        className="hov-dark"
        onClick={connectAgent}
        style={{
          marginTop: 12,
          width: '100%',
          height: 38,
          border: 0,
          borderRadius: 11,
          background: color.ink,
          color: '#fff',
          fontFamily: 'inherit',
          fontSize: 13.5,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        Connect an agent
      </button>

      <div
        style={{
          marginTop: 12,
          paddingTop: 12,
          borderTop: `1px solid ${color.borderSoft}`,
          fontSize: 11.5,
          lineHeight: 1.5,
          color: color.textDim,
        }}
      >
        {PROVISIONAL_NOTE}
      </div>

      <div
        style={{
          marginTop: 10,
          fontSize: 11.5,
          lineHeight: 1.5,
          color: color.textGhost,
        }}
      >
        {OPERATOR_ONBOARDING_NOTE}
        {platform.agentClaiming === 'closed' && ' Claiming reopens with them.'}
      </div>
    </div>
  );
}
