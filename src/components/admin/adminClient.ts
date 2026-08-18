/**
 * Signing in to the panel, and reading it.
 *
 * Google sign-in rather than an email and password field, and that is a
 * security decision rather than a convenience one: a password box on a page
 * like this is a thing to phish, a thing to leak, and a thing I would have to
 * store. Delegating to a provider means Aiskimo never sees a credential and the
 * second factor is somebody else's problem, already solved.
 *
 * Authorisation is not decided here. The browser gets an ID token and sends it;
 * whether that token belongs to an administrator is checked server-side against
 * an allowlist the browser cannot see or influence. Everything in this file is
 * about *acquiring* proof of identity — nothing in it grants anything, and a
 * modified copy of this bundle gains its author precisely nothing.
 */

import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';

import { getFirebaseAuth } from '@/lib/firebase/client';
import { isFirebaseConfigured } from '@/lib/firebase/config';
import type { AdminOverview } from '@/domain/metrics';

export { isFirebaseConfigured };

export interface AdminUser {
  email: string;
  name: string | null;
  photoUrl: string | null;
}

function toAdminUser(user: User): AdminUser {
  return { email: user.email ?? '', name: user.displayName, photoUrl: user.photoURL };
}

/** Calls back with the signed-in user, or null. Returns an unsubscribe. */
export function watchSession(onChange: (user: AdminUser | null) => void): () => void {
  if (!isFirebaseConfigured) {
    onChange(null);
    return () => {};
  }
  return onAuthStateChanged(getFirebaseAuth(), (user) => onChange(user ? toAdminUser(user) : null));
}

export async function signIn(): Promise<void> {
  const provider = new GoogleAuthProvider();
  // Always show the chooser. Without this, a browser with one Google session
  // signs that account straight in — which on a shared or work machine means
  // the panel silently rejects you and you cannot tell why.
  provider.setCustomParameters({ prompt: 'select_account' });
  await signInWithPopup(getFirebaseAuth(), provider);
}

export async function signOutAdmin(): Promise<void> {
  await signOut(getFirebaseAuth());
}

export class AdminError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Fetches the overview with a fresh ID token.
 *
 * Firebase ID tokens last an hour, and a dashboard left open on a second
 * monitor outlives that comfortably. `getIdToken()` refreshes when it is close
 * to expiry, so the panel does not sign itself out overnight.
 */
export async function fetchOverview(): Promise<AdminOverview> {
  const user = getFirebaseAuth().currentUser;
  if (!user) throw new AdminError('Sign in to view this.', 401);

  const response = await fetch('/api/admin/overview', {
    headers: { Authorization: `Bearer ${await user.getIdToken()}` },
  });

  if (!response.ok) {
    const detail = await response
      .json()
      .then((body) => (body as { error?: { message?: string } })?.error?.message)
      .catch(() => undefined);
    throw new AdminError(detail ?? `Request failed (${response.status}).`, response.status);
  }

  return (await response.json()) as AdminOverview;
}
