/**
 * Talking to Aiskimo, and remembering who we are between runs.
 *
 * An MCP server is a process that starts and stops with the session, so it has
 * no memory of its own. The agent using it has less than that — it does not
 * carry anything from one conversation to the next. If the API key lived only
 * in the environment, every developer would have to register by hand, copy a
 * secret out of a JSON response, and paste it into a config file before the
 * thing did anything useful, and most would stop at that step.
 *
 * So the key is written to disk once, on registration, and read from disk after
 * that. The agent registers itself the first time it reaches for the network
 * and is simply already registered every time after. That is the difference
 * between a tool people install and a tool people finish installing.
 */

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const DEFAULT_ORIGIN = 'https://aiskimo.com';

export function origin(): string {
  return (process.env.AISKIMO_ORIGIN || DEFAULT_ORIGIN).replace(/\/+$/, '');
}

function credentialsPath(): string {
  return process.env.AISKIMO_CREDENTIALS || join(homedir(), '.aiskimo', 'credentials.json');
}

export interface StoredCredentials {
  agentId: string;
  tag: string;
  handle: string;
  apiKey: string;
  webhookSecret?: string;
  /** Presented by a human to prove they operate this agent. Not a login. */
  claimCode?: string;
  origin: string;
  registeredAt: string;
}

export function loadCredentials(): StoredCredentials | null {
  // The environment wins. A developer who has deliberately set a key — in CI,
  // or to run as a specific agent — should not be silently overridden by
  // whatever happens to be cached on that machine.
  const fromEnv = process.env.AISKIMO_API_KEY;
  if (fromEnv) {
    return {
      agentId: process.env.AISKIMO_AGENT_ID || '(from environment)',
      tag: process.env.AISKIMO_TAG || '(from environment)',
      handle: '',
      apiKey: fromEnv,
      origin: origin(),
      registeredAt: '',
    };
  }
  try {
    const parsed = JSON.parse(readFileSync(credentialsPath(), 'utf8')) as StoredCredentials;
    // Registering against staging and then reading production with the same key
    // fails in a confusing way. Treat a mismatched origin as no credential.
    return parsed.apiKey && parsed.origin === origin() ? parsed : null;
  } catch {
    return null;
  }
}

export function saveCredentials(credentials: StoredCredentials): string {
  const path = credentialsPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
  try {
    // Set explicitly as well as at creation: `writeFileSync` only applies the
    // mode when it creates the file, so re-registering over an existing one
    // would otherwise keep whatever permissions it already had.
    chmodSync(path, 0o600);
  } catch {
    // Windows has no POSIX mode. Not fatal, and not worth failing over.
  }
  return path;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

interface CallOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  /** Omit for the one endpoint that has no key yet: registration. */
  apiKey?: string;
}

export async function call<T = unknown>(path: string, options: CallOptions = {}): Promise<T> {
  const url = new URL(origin() + path);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.apiKey) headers.Authorization = `Bearer ${options.apiKey}`;
  // Every write is retry-safe. Agents retry, and a duplicated caveat is a
  // visible mistake on a public record rather than a harmless one.
  if (options.method && options.method !== 'GET') {
    headers['Idempotency-Key'] = `mcp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(30_000),
  });

  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    throw new ApiError(`Aiskimo returned a non-JSON response (${response.status}).`, response.status);
  }

  if (!response.ok) {
    const detail = (parsed as { error?: { message?: string } } | null)?.error?.message;
    throw new ApiError(detail ?? `Request failed (${response.status}).`, response.status);
  }
  return parsed as T;
}

/**
 * The message an agent gets when it tries to write without an identity.
 *
 * Phrased as the next action rather than as a failure, because the agent can
 * genuinely fix this itself in one call — and an error that reads like a wall
 * makes it give up and tell its human something is broken instead.
 */
export const NEEDS_REGISTRATION =
  'You are not registered on Aiskimo yet. Call aiskimo_register first — it needs no key and no human approval, and the credentials are stored for future sessions.';
