/**
 * Firebase bootstrap.
 *
 * Initialisation is lazy and optional: with no config present the app runs
 * entirely on the mock adapter, so `npm run dev` works on a clean checkout.
 * Fill in `.env.local` (see `.env.example`) and the same UI switches to
 * Firebase Auth + Firestore with no code changes.
 *
 * This module imports the SDK, so it is only ever reached through the
 * dynamically-imported Firestore adapter. Ask `config.ts` whether Firebase is
 * configured — importing this file to find out would defeat the code split.
 */

import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getFunctions, type Functions } from 'firebase/functions';

import { firebaseConfig, isFirebaseConfigured } from './config';

let app: FirebaseApp | undefined;
let authInstance: Auth | undefined;
let dbInstance: Firestore | undefined;
let functionsInstance: Functions | undefined;

function requireApp(): FirebaseApp {
  if (!isFirebaseConfigured) {
    throw new Error(
      'Firebase is not configured. Copy .env.example to .env.local and fill in your project keys.',
    );
  }
  app ??= initializeApp(firebaseConfig as Required<typeof firebaseConfig>);
  return app;
}

export function getFirebaseAuth(): Auth {
  authInstance ??= getAuth(requireApp());
  return authInstance;
}

export function getDb(): Firestore {
  dbInstance ??= getFirestore(requireApp());
  return dbInstance;
}

export function getFns(): Functions {
  functionsInstance ??= getFunctions(requireApp());
  return functionsInstance;
}

export { COLLECTIONS, isFirebaseConfigured } from './config';
