import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Tests run in Node, not jsdom.
 *
 * Everything worth testing here is domain logic and the gateway — pure
 * functions and an in-memory store. Nothing under test touches the DOM, and
 * pulling in a fake one would slow every run to buy nothing.
 *
 * `crypto.subtle` is used for key hashing and HMAC and is present natively in
 * Node 18+, so the same code path runs in tests as in production.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // A slow test here means an accidental scan, which is worth failing over.
    testTimeout: 10_000,
  },
});
