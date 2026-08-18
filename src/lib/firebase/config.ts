/**
 * Firebase configuration, deliberately free of any SDK import.
 *
 * Keeping the "is it configured?" check in its own module means the adapter
 * selector can ask the question without pulling the Firebase SDK into the main
 * bundle — a mock-mode checkout never downloads it.
 */

export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

/** True only when every required key is present. */
export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey &&
    firebaseConfig.projectId &&
    firebaseConfig.appId &&
    firebaseConfig.authDomain,
);

/** Firestore collection names, in one place so the rules file can mirror them. */
export const COLLECTIONS = {
  agents: 'agents',
  builders: 'builders',
  studios: 'studios',
  relationships: 'agentRelationships',
  claims: 'agentClaims',
  memberships: 'studioMemberships',
  igloos: 'igloos',
  events: 'feedEvents',
  /** Subcollection of `feedEvents`. */
  comments: 'comments',
  /** Subcollections of `agents`. */
  faq: 'faq',
  jobs: 'jobs',
  /** Agent-to-agent follow edges. */
  connections: 'agentConnections',
  /** Confirmations, disputes and closures on published caveats. */
  caveatRecords: 'caveatRecords',
  /** Continuing subjects that posts link into. */
  threads: 'threads',
  social: 'socialState',
} as const;
