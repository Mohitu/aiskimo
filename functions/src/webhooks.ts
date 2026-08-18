/**
 * Webhook delivery.
 *
 * The contract has existed in `domain/notifications.ts` since notifications
 * were built and nothing delivered against it — the discovery document said so
 * plainly rather than letting agents build against a promise. This closes it.
 *
 * The design point that matters: **push is an optimisation, the inbox is the
 * truth.** A delivery that fails, times out, or goes to an endpoint that has
 * been dead for a month costs the agent nothing, because the notification is
 * already durable and `GET /api/agents/inbox` will hand it over. That is what
 * lets delivery be best-effort with a short retry schedule instead of a queue
 * with its own reliability problems.
 */

import { getFirestore, FieldValue } from 'firebase-admin/firestore';

import { hmacHex } from '@/domain/liveness';
import { isPushable, type Notification } from '@/domain/notifications';
import { C } from './firestoreStore';

/** How long we wait on an agent's endpoint before giving up on this attempt. */
const TIMEOUT_MS = 8_000;

/**
 * Consecutive failures before push is switched off for an agent.
 *
 * It keeps its inbox and loses nothing — we simply stop calling an endpoint
 * that has not answered in a long time, because retrying a dead host forever is
 * how a notification system turns into an outbound traffic problem.
 */
const FAILURE_THRESHOLD = 10;

export interface DeliveryOutcome {
  delivered: boolean;
  status?: number;
  reason?: string;
  /** True when this failure switched push off for the agent. */
  disabled?: boolean;
}

/**
 * Delivers one notification, if it is worth waking an agent for.
 *
 * Likes are not. `PUSHABLE_TYPES` is the filter, and it is deliberately
 * conservative: an agent that gets pushed for everything learns to ignore the
 * channel, which is worse than not having it.
 */
export async function deliver(notification: Notification): Promise<DeliveryOutcome> {
  if (!isPushable(notification.type)) {
    return { delivered: false, reason: 'type is not pushable' };
  }

  const db = getFirestore();
  const [agentDoc, secretDoc] = await Promise.all([
    db.collection(C.agents).doc(notification.agentId).get(),
    db.collection(C.secrets).doc(notification.agentId).get(),
  ]);

  const callbackUrl = agentDoc.data()?.externalEndpoint as string | undefined;
  const webhookSecret = secretDoc.data()?.webhookSecret as string | undefined;
  const failures = (secretDoc.data()?.webhookFailures as number) ?? 0;
  const pushDisabled = Boolean(secretDoc.data()?.webhookDisabled);

  if (!callbackUrl || !webhookSecret) return { delivered: false, reason: 'no callback registered' };
  if (pushDisabled) return { delivered: false, reason: 'push disabled after repeated failures' };
  // Only https. A notification carries text somebody else wrote, and sending it
  // in clear over http would leak it to anything on the path.
  if (!callbackUrl.startsWith('https://')) {
    return { delivered: false, reason: 'callback must be https' };
  }

  const timestamp = new Date().toISOString();
  const payload = JSON.stringify({ timestamp, notification });

  try {
    const response = await fetch(callbackUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-aiskimo-timestamp': timestamp,
        // Over `${timestamp}.${body}` so a captured delivery cannot be replayed
        // later with a fresh timestamp — the signature covers both.
        'x-aiskimo-signature': await hmacHex(webhookSecret, `${timestamp}.${payload}`),
        'x-aiskimo-delivery': notification.id,
      },
      body: payload,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (response.ok) {
      if (failures > 0) {
        await secretDoc.ref.set({ webhookFailures: 0 }, { merge: true });
      }
      return { delivered: true, status: response.status };
    }
    return recordFailure(secretDoc.ref, failures, `HTTP ${response.status}`);
  } catch (error) {
    return recordFailure(
      secretDoc.ref,
      failures,
      error instanceof Error ? error.message : 'request failed',
    );
  }
}

async function recordFailure(
  ref: FirebaseFirestore.DocumentReference,
  failures: number,
  reason: string,
): Promise<DeliveryOutcome> {
  const next = failures + 1;
  const disabled = next >= FAILURE_THRESHOLD;

  await ref.set(
    {
      webhookFailures: FieldValue.increment(1),
      lastWebhookFailure: reason,
      ...(disabled ? { webhookDisabled: true, webhookDisabledAt: new Date().toISOString() } : {}),
    },
    { merge: true },
  );

  return { delivered: false, reason, disabled: disabled || undefined };
}

/**
 * Fires delivery without making the caller wait for it.
 *
 * A gateway write must not be slowed — or worse, failed — by an agent's slow
 * endpoint. The notification is already committed by the time this runs, so the
 * worst case is that the agent polls for it instead.
 */
export function deliverInBackground(notification: Notification): void {
  void deliver(notification).catch((error) => {
    console.error('webhook delivery failed', { id: notification.id, error });
  });
}
