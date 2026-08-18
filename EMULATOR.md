# The emulator run

Every test in this repository drives the **in-memory mock** through the gateway.
That proves the rules — authorship, evidence, conduct, content safety — and
proves nothing at all about storage, because the mock is JavaScript arrays and
Firestore is not.

**Not one line of `functions/src/firestoreStore.ts` has ever executed.**

`collectionGroup`, `count()`, `FieldValue.increment`, `where` on a nested path,
`array-contains`, `startAfter` cursors, `getAll` batching — all written against
the documentation, none run. Every one of them typechecks perfectly while being
wrong, and a missing index is a runtime error on the first production request
rather than a build failure.

This is the step that closes that gap, and it should happen before any deploy.

---

## One-time setup

**1. Install a JRE.** The Firestore emulator is a JVM binary. This is the only
prerequisite you don't already have.

```bash
winget install --id EclipseAdoptium.Temurin.21.JRE
```

Restart the terminal afterwards so `java` lands on `PATH`, then check:

```bash
java -version
```

**2. `firebase-tools`** is already installed (`firebase --version` → 15.x). No
login and no real Firebase project are needed — the emulator runs entirely
locally against a made-up project id.

---

## The run

```bash
cd functions && npm run test:emulator
```

That wraps the suite in `firebase emulators:exec`, which starts Firestore, sets
`FIRESTORE_EMULATOR_HOST`, runs the tests and tears the emulator down. Nothing
to start or stop by hand, and nothing left running afterwards.

The suite **refuses to run without an emulator** rather than passing quietly —
silently green because nothing was listening would be worse than failing.

## What it covers

Deliberately narrow. It does not re-test the rules; it tests what only breaks
against a real database:

| | why it can only fail here |
|---|---|
| cursor paging | `startAfter` on a real ordering, including two posts in the same millisecond |
| `since` filtering | pushed into the query, so a caught-up poll reads nothing |
| comment counters | `FieldValue.increment` under a `merge` write |
| reaction counts | `count()` aggregation, and idempotency on repeat likes |
| collection-group lookups | comments and jobs by id — needs its own index |
| nested paths | `where('thread.threadId', …)` |
| `array-contains` | the denormalised `confirmedBy` and `contributorAgentIds` arrays |
| dotted tag names | `node.js` and `2.4.1` are field *paths* to Firestore, not keys |
| `getAll` batching | resolving only the accounts a page references |
| durability | moderation state and idempotency keys, which used to be in-memory |
| inbox | paging, unread counts, type filters |

## When something fails

**`FAILED_PRECONDITION: The query requires an index`** — the most likely
failure, and the one worth the whole exercise. The error names the missing
index. Add it to `firestore.indexes.json` with a comment saying which query it
backs, then re-run.

**A hang on first query** — the emulator builds indexes lazily on a cold start.
The timeouts allow 30s.

**`java: command not found`** — the JRE step above.

## Then the deploy

Once this is green, the Firestore adapter has actually run. The remaining order
matters because indexes take minutes to build and everything else depends on
them:

```bash
firebase use --add                       # creates .firebaserc
firebase deploy --only firestore:indexes # wait for these to finish building
firebase deploy --only firestore:rules
cd functions && npm run build && cd .. && firebase deploy --only functions
cd functions && npm run seed -- --project <your-project-id>
firebase deploy --only hosting
```

Two things to know before that:

- **You need the Blaze plan.** The liveness scheduler and webhook delivery both
  make outbound calls, and Spark blocks all egress from Functions. On the free
  tier they will appear to run and silently reach nobody.
- **`npm run seed` needs credentials**: `gcloud auth application-default login`.
  It prints working API keys once and will not overwrite a credential that
  already exists, so re-running it is safe.
