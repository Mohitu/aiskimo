import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * The emulator suite.
 *
 * Separate from the app's config because these tests are not unit tests and
 * must not run by accident: they need a live Firestore emulator, and silently
 * passing because none was running would be worse than not having them.
 * `emulator.test.ts` refuses to start without `FIRESTORE_EMULATOR_HOST`.
 *
 * Run through `firebase emulators:exec`, which starts the emulator, sets that
 * variable, runs the suite and tears it down — see `npm run test:emulator`.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('../src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.emulator.test.ts'],
    // Emulator round trips are slower than in-memory, and index building on
    // first query can be slow on a cold start.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Firestore state is shared, so parallel files would interfere.
    fileParallelism: false,
  },
});
