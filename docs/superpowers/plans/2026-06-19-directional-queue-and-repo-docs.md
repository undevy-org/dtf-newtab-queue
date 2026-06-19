# Directional Queue (forward/archive) + Open-Repo Docs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split queue navigation into an automatic forward "catch up on new" direction and an explicit one-batch-per-press "archive" direction, so the feed honestly ends; then add standard open-source documentation.

**Architecture:** Introduce a forward fetch that targets the first DTF page and never disturbs the archive cursor (`lastId`), seeding `lastId` only when it is still `null`. `markViewed`/`openCurrent`/`retry` use forward catch-up when the backlog empties; a new `loadArchive()` action drives the existing backward, bounded, `lastId`-advancing fetch one usable batch at a time. The UI renders three states (Card, Fork, Archive-ended). The persisted schema is unchanged; the existing `exhausted` boolean is redefined to mean "the archive direction has ended".

**Tech Stack:** Vanilla ES modules, Node.js built-in test runner (`node --test`), Chromium MV3 extension APIs (`chrome.storage.local`, `chrome.tabs`, Web Locks). No build step, zero dependencies.

## Global Constraints

- Node.js 20+ (`node --test`, `node --check`); no third-party dependencies.
- Pure ES modules (`"type": "module"`).
- No persisted-schema changes: state stays `{ current, backlog, seenIds, lastId, initializedAt, updatedAt, exhausted, events }` (see `src/queueStore.js`). `isQueueState` must keep passing unchanged.
- Render UI text only via DOM text nodes (`textContent`); never `innerHTML`.
- Outbound URLs must pass `isSafeDtfUrl` (HTTPS on `dtf.ru` or a subdomain) before opening.
- DTF `lastId` is a **backward** cursor (older items). Forward fetches must never overwrite a non-null `state.lastId`.
- Status mapping (unchanged in `statusForState`): `current` present → `"ready"`; `current` null & `exhausted` → `"empty"` (Archive-ended); `current` null & not `exhausted` → `"idle"` (Fork).
- License: MIT, copyright holder `undevy-org`. Repo: `https://github.com/undevy-org/dtf-newtab-queue`.
- Commit after every task. Stage only the listed files (multi-agent repo — never `git add -A`).

---

## File Structure

| File | Change | Responsibility |
| --- | --- | --- |
| `src/queueService.js` | Modify | Add forward fetch + `showForwardItems`; rewire `markViewed`/`openCurrent`/`retry` to forward; add `loadArchive()` (backward); remove now-unused `resume`/`fetchFirstPageItems`/`startFromFirstPage`. |
| `src/newtab.js` | Modify | Render Card / Fork / Archive-ended; add `Глубже в архив` button → `loadArchive()`; fold the old retryable-idle screen into Fork. |
| `test/queueService.test.js` | Modify | Rewrite backward-on-`markViewed` tests to forward semantics; add forward-preserves-`lastId`, `loadArchive`, and seed-vs-preserve tests. |
| `LICENSE` | Create | MIT text. |
| `CONTRIBUTING.md` | Create | Dev setup, test commands, conventions, PR flow. |
| `SECURITY.md` | Create | Private disclosure policy, scope, supported versions. |
| `package.json` | Modify | Add `license`, `repository`, `bugs`, `homepage`, `keywords`, fuller `description`. |
| `README.md` | Modify | `credentials: "include"` note; two-button UX; links to CHANGELOG/LICENSE/CONTRIBUTING/SECURITY. |
| `CHANGELOG.md` | Modify | Record both parts under `[Unreleased]`. |

---

## Task 1: Forward catch-up for `markViewed` / `openCurrent`

Replace the backward "load older when backlog empties" behaviour of the advance actions with a forward "catch up on new" fetch that preserves the archive cursor.

**Files:**
- Modify: `src/queueService.js`
- Test: `test/queueService.test.js`

**Interfaces:**
- Consumes: `fetchNews({})` from `src/dtfApi.js` (returns `{ items, lastId }`); existing `dedupeItems`, `appendQueueEvent`, `normalizeFetchedBatch`, `showItems`, `showNextBacklogItem`, `addSeenId`, `save`, `saveError`.
- Produces (used by Tasks 2 & 3):
  - `fetchNewerItems(state): Promise<{ state, items }>` — single forward page; preserves `state.lastId` if non-null, otherwise seeds it from the fetched page; never advances past the first page.
  - `showForwardItems(state, items, now): state` — on items, sets `current`/`backlog`, `exhausted=false`, logs `"shown"`; on empty, sets `current=null`/`backlog=[]`, `exhausted=false`, logs `"caught-up"` with `{ reason: "no-newer-items" }`.

- [ ] **Step 1: Write the failing test — forward catch-up preserves `lastId`**

Replace the existing test at `test/queueService.test.js:324` (`"deduplicates already seen, current, and repeated fetched IDs"`) with this stronger version (same scenario, now asserting the cursor is preserved):

```js
  it("markViewed catches up on newer items and preserves the archive cursor", async () => {
    const { api, service, store } = await createHarness({
      initialState: stateWith({
        current: item(1),
        seenIds: [7],
        lastId: 100
      }),
      batches: [
        {
          items: [item(1), item(7), item(8), item(8), item(9)],
          lastId: 900
        }
      ]
    });

    await service.markViewed();
    const stored = await store.getState();

    assert.deepEqual(api.calls, [{}]);
    assert.equal(stored.current.id, 8);
    assert.deepEqual(stored.backlog.map((newsItem) => newsItem.id), [9]);
    assert.deepEqual(stored.seenIds, [7, 1]);
    assert.equal(stored.lastId, 100);
    assert.equal(stored.exhausted, false);
  });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test --test-name-pattern="catches up on newer items and preserves" test/queueService.test.js`
Expected: FAIL — current code calls `fetchNews({ lastId: 100 })` (asserts `api.calls` mismatch) and overwrites `lastId` to `900`.

- [ ] **Step 3: Add the forward helpers in `src/queueService.js`**

Add these two functions next to `rememberFetch` (after line 91) and `showItems`:

```js
function rememberForwardFetch(state, batch, now) {
  const fetched = normalizeFetchedBatch(batch);
  const nextLastId = state.lastId === null ? fetched.lastId : state.lastId;
  const nextState = appendQueueEvent(
    state,
    "fetch",
    {
      requestedLastId: null,
      resultCount: fetched.items.length,
      nextLastId
    },
    now
  );

  return {
    state: {
      ...nextState,
      lastId: nextLastId
    },
    items: fetched.items
  };
}

function showForwardItems(state, items, now) {
  if (items.length === 0) {
    return appendQueueEvent(
      { ...state, current: null, backlog: [], exhausted: false },
      "caught-up",
      { reason: "no-newer-items" },
      now
    );
  }

  const [current, ...backlog] = items;

  return appendQueueEvent(
    { ...state, current, backlog, exhausted: false },
    "shown",
    { id: current.id },
    now
  );
}
```

- [ ] **Step 4: Add `fetchNewerItems` inside `createQueueService`**

Add this near `fetchNextUsableItems` (after line 260), referencing the injected `fetchNews`/`now`:

```js
  async function fetchNewerItems(state) {
    const fetched = await fetchNews({});
    const remembered = rememberForwardFetch(state, fetched, now);
    const items = dedupeItems(remembered.items, remembered.state);
    return { state: remembered.state, items };
  }
```

- [ ] **Step 5: Rewire the empty-backlog branch of `advance()`**

In `advance()` (lines 287-300), replace the backward block:

```js
    nextState = {
      ...nextState,
      current: null,
      exhausted: false
    };

    try {
      const fetched = await fetchNextUsableItems(nextState);
      nextState = showItems(fetched.state, fetched.items, now);
    } catch (error) {
      return saveError(originalState, actionType, error);
    }

    return resultFor(await save(nextState));
```

with:

```js
    nextState = {
      ...nextState,
      current: null,
      exhausted: false
    };

    try {
      const fetched = await fetchNewerItems(nextState);
      nextState = showForwardItems(fetched.state, fetched.items, now);
    } catch (error) {
      return saveError(originalState, actionType, error);
    }

    return resultFor(await save(nextState));
```

- [ ] **Step 6: Rewire the empty-backlog branch of `openCurrent()`**

In `openCurrent()` (lines 386-399), replace:

```js
        openedState = {
          ...openedState,
          current: null,
          exhausted: false
        };
        await save(openedState);

        try {
          const fetched = await fetchNextUsableItems(openedState);
          const nextState = showItems(fetched.state, fetched.items, now);
          return resultFor(await save(nextState));
        } catch (error) {
          return saveError(openedState, "opened", error);
        }
```

with:

```js
        openedState = {
          ...openedState,
          current: null,
          exhausted: false
        };
        await save(openedState);

        try {
          const fetched = await fetchNewerItems(openedState);
          const nextState = showForwardItems(fetched.state, fetched.items, now);
          return resultFor(await save(nextState));
        } catch (error) {
          return saveError(openedState, "opened", error);
        }
```

- [ ] **Step 7: Run the new test — it passes**

Run: `node --test --test-name-pattern="catches up on newer items and preserves" test/queueService.test.js`
Expected: PASS.

- [ ] **Step 8: Fix the other advance-path tests broken by the new semantics**

Apply these replacements in `test/queueService.test.js`:

(a) Replace `"markViewed fetches the next page only when backlog is empty"` (line 176):

```js
  it("markViewed fetches newer items (forward) when backlog is empty", async () => {
    const { api, service, store } = await createHarness({
      initialState: stateWith({
        current: item(1),
        lastId: 100
      }),
      batches: [{ items: [item(4), item(5)], lastId: 500 }]
    });

    await service.markViewed();
    const stored = await store.getState();

    assert.deepEqual(api.calls, [{}]);
    assert.equal(stored.current.id, 4);
    assert.deepEqual(stored.backlog.map((newsItem) => newsItem.id), [5]);
    assert.deepEqual(stored.seenIds, [1]);
    assert.equal(stored.lastId, 100);
    assert.equal(stored.exhausted, false);
  });
```

(b) In `"markViewed logs dismissal before pagination fetch and showing"` (line 196), change the call assertion (the events assertion stays `["dismissed", "fetch", "shown"]`):

```js
    assert.deepEqual(api.calls, [{}]);
```

(Add this `assert.deepEqual(api.calls, [{}]);` after `await service.markViewed();`/`store.getState()` and keep the existing events assertion.)

(c) Replace `"markViewed exhausts without fetching when no pagination cursor remains"` (line 215) — markViewed now always forward-fetches on empty backlog:

```js
  it("markViewed reaches the fork (not exhausted) when no newer items exist", async () => {
    const { api, service, store } = await createHarness({
      initialState: stateWith({
        current: item(1),
        lastId: 100
      }),
      batches: [{ items: [item(1)], lastId: 900 }]
    });

    const result = await service.markViewed();
    const stored = await store.getState();

    assert.equal(result.status, "idle");
    assert.deepEqual(api.calls, [{}]);
    assert.equal(stored.current, null);
    assert.deepEqual(stored.seenIds, [1]);
    assert.equal(stored.lastId, 100);
    assert.equal(stored.exhausted, false);
    assert.deepEqual(stored.events.map((event) => event.type), [
      "dismissed",
      "fetch",
      "caught-up"
    ]);
  });
```

(d) Replace `"sets exhausted when the API returns no usable new items and no backlog remains"` (line 373):

```js
  it("reaches the fork when the forward page has no usable new items", async () => {
    const { service, store } = await createHarness({
      initialState: stateWith({
        current: item(1),
        seenIds: [2, 3],
        lastId: 100
      }),
      batches: [{ items: [item(1), item(2), item(3)], lastId: 400 }]
    });

    const result = await service.markViewed();
    const stored = await store.getState();

    assert.equal(result.status, "idle");
    assert.equal(stored.current, null);
    assert.deepEqual(stored.backlog, []);
    assert.deepEqual(stored.seenIds, [2, 3, 1]);
    assert.equal(stored.lastId, 100);
    assert.equal(stored.exhausted, false);
    assert.equal(stored.events.at(-1).type, "caught-up");
  });
```

(e) Delete the two backward-loop tests that are now Task 2's responsibility: `"continues bounded pagination when a fetched page contains only duplicates"` (line 239) and `"exhausts after the bounded pagination limit returns only duplicates"` (line 292). Also delete `"stops pagination after one empty API page even when it has a cursor"` (line 264). They are re-added as `loadArchive` tests in Task 2.

- [ ] **Step 9: Run the full suite**

Run: `node --test test/*.test.js`
Expected: the advance-path tests above PASS. Retry/cursorless tests (lines 395-566, 701-742) may still FAIL — they are fixed in Task 3. Confirm no NEW failures beyond retry-related ones.

- [ ] **Step 10: Commit**

```bash
git add src/queueService.js test/queueService.test.js
git commit -m "feat: forward catch-up on empty backlog, preserving archive cursor

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Explicit `loadArchive()` action (backward, one batch per press)

Expose the existing backward, bounded, `lastId`-advancing fetch as a dedicated action used only by the "Глубже в архив" button.

**Files:**
- Modify: `src/queueService.js`
- Test: `test/queueService.test.js`

**Interfaces:**
- Consumes: existing `fetchNextUsableItems(state)` (backward, bounded by `MAX_FETCH_PAGES_PER_ACTION`, advances `lastId`), `showItems` (sets `exhausted=true` on empty), `showNextBacklogItem`, `save`, `saveError`, `withQueueMutationLock`.
- Produces: `service.loadArchive(): Promise<{ state, status, error }>` — when `current` is set, a no-op returning `"ready"`; when a backlog exists, shows the next backlog item; otherwise fetches one backward batch, setting `exhausted=true` when the archive yields nothing.

- [ ] **Step 1: Write the failing tests for `loadArchive`**

Add these three tests inside the `describe("queueService", ...)` block (e.g. after the advance tests). They are the backward equivalents of the deleted tests from Task 1 Step 8(e):

```js
  it("loadArchive fetches one older batch from the fork and advances lastId", async () => {
    const { api, service, store } = await createHarness({
      initialState: stateWith({
        current: null,
        seenIds: [2, 3],
        lastId: 100
      }),
      batches: [
        { items: [item(1), item(2)], lastId: 200 },
        { items: [item(3), item(4), item(5)], lastId: 500 }
      ]
    });

    const result = await service.loadArchive();
    const stored = await store.getState();

    assert.equal(result.status, "ready");
    assert.deepEqual(api.calls, [{ lastId: 100 }, { lastId: 200 }]);
    assert.equal(stored.current.id, 4);
    assert.deepEqual(stored.backlog.map((newsItem) => newsItem.id), [5]);
    assert.equal(stored.lastId, 500);
    assert.equal(stored.exhausted, false);
  });

  it("loadArchive exhausts on an empty older page", async () => {
    const { api, service, store } = await createHarness({
      initialState: stateWith({ current: null, lastId: 100 }),
      batches: [
        { items: [], lastId: 200 },
        { items: [item(2)], lastId: 300 }
      ]
    });

    const result = await service.loadArchive();
    const stored = await store.getState();

    assert.equal(result.status, "empty");
    assert.deepEqual(api.calls, [{ lastId: 100 }]);
    assert.equal(stored.current, null);
    assert.equal(stored.lastId, 200);
    assert.equal(stored.exhausted, true);
    assert.equal(stored.events.at(-1).type, "empty");
  });

  it("loadArchive exhausts after three duplicate-only older pages", async () => {
    const { api, service, store } = await createHarness({
      initialState: stateWith({
        current: null,
        seenIds: [1, 2, 3, 4, 5, 6],
        lastId: 100
      }),
      batches: [
        { items: [item(1), item(2)], lastId: 200 },
        { items: [item(3), item(4)], lastId: 300 },
        { items: [item(5), item(6)], lastId: 400 },
        { items: [item(7)], lastId: 700 }
      ]
    });

    const result = await service.loadArchive();
    const stored = await store.getState();

    assert.equal(result.status, "empty");
    assert.deepEqual(api.calls, [
      { lastId: 100 },
      { lastId: 200 },
      { lastId: 300 }
    ]);
    assert.equal(stored.lastId, 400);
    assert.equal(stored.exhausted, true);
  });

  it("loadArchive shows the next backlog item without fetching", async () => {
    const { api, service, store } = await createHarness({
      initialState: stateWith({
        current: null,
        backlog: [item(8), item(9)],
        lastId: 100
      })
    });

    const result = await service.loadArchive();
    const stored = await store.getState();

    assert.equal(result.status, "ready");
    assert.deepEqual(api.calls, []);
    assert.equal(stored.current.id, 8);
  });
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test --test-name-pattern="loadArchive" test/queueService.test.js`
Expected: FAIL — `service.loadArchive is not a function`.

- [ ] **Step 3: Implement `loadArchive()` in the returned service object**

Add this action to the object returned by `createQueueService` (alongside `retry`/`reset`):

```js
    async loadArchive() {
      return withQueueMutationLock(async () => {
        const state = await store.getState();

        if (state.current) {
          return resultFor(state);
        }

        if (state.backlog.length > 0) {
          return resultFor(await save(showNextBacklogItem(state, now)));
        }

        try {
          const fetched = await fetchNextUsableItems(state);
          const nextState = showItems(fetched.state, fetched.items, now);
          return resultFor(await save(nextState));
        } catch (error) {
          return saveError(state, "archive", error);
        }
      });
    },
```

- [ ] **Step 4: Run the `loadArchive` tests — they pass**

Run: `node --test --test-name-pattern="loadArchive" test/queueService.test.js`
Expected: PASS (all four).

- [ ] **Step 5: Commit**

```bash
git add src/queueService.js test/queueService.test.js
git commit -m "feat: add explicit loadArchive action for backward paging

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Forward `retry()` ("Проверить новые") and cleanup

Make `retry()` a forward catch-up and remove the now-dead backward-from-first-page code.

**Files:**
- Modify: `src/queueService.js`
- Test: `test/queueService.test.js`

**Interfaces:**
- Consumes: `fetchNewerItems`, `showForwardItems` (Task 1), `showNextBacklogItem`, `save`, `saveError`.
- Produces: `service.retry()` performs a forward fetch (seeding `lastId` when null, preserving it otherwise); the old `resume()` and `fetchFirstPageItems()` helpers and the `startFromFirstPage` option of `fetchUsableItems` are removed.

- [ ] **Step 1: Update the retry tests to forward semantics**

Apply these edits in `test/queueService.test.js`:

(a) Replace `"retry fetches again from exhausted empty state"` (line 395):

```js
  it("retry checks newer items and preserves the archive cursor", async () => {
    const { api, service, store } = await createHarness({
      initialState: stateWith({
        current: null,
        exhausted: true,
        seenIds: [1],
        lastId: 100
      }),
      batches: [{ items: [item(2), item(3)], lastId: 300 }]
    });

    const result = await service.retry();
    const stored = await store.getState();

    assert.equal(result.status, "ready");
    assert.deepEqual(api.calls, [{}]);
    assert.equal(stored.current.id, 2);
    assert.deepEqual(stored.backlog.map((newsItem) => newsItem.id), [3]);
    assert.deepEqual(stored.seenIds, [1]);
    assert.equal(stored.lastId, 100);
    assert.equal(stored.exhausted, false);
  });
```

(b) `"retry fetches the first page after initial fetch failure without resetting history"` (line 418): the only change is unchanged-`{}` calls already match. Verify `api.calls` stays `[{}, {}]` and leave the rest. No edit needed unless it fails; if `lastId` is asserted it is not in this test, so it passes as-is.

(c) `"retry checks the first page from an exhausted null cursor and deduplicates seen items"` (line 449): passes as-is (`lastId` was `null`, so forward seeds it to `300`; `api.calls` is `[{}]`). No edit needed.

(d) Replace `"cursorless retry continues from a duplicate-only first page to unseen items"` (line 485) — forward is single-page now, so an all-duplicate first page lands on the Fork:

```js
  it("cursorless retry stops at the first page (no forward pagination)", async () => {
    const { api, service, store } = await createHarness({
      initialState: stateWith({
        seenIds: [1, 2],
        lastId: null,
        exhausted: true,
        events: [
          {
            type: "empty",
            at: "2026-06-17T09:00:00.000Z",
            details: { reason: "no-usable-items" }
          }
        ]
      }),
      batches: [{ items: [item(1), item(2)], lastId: 100 }]
    });

    const result = await service.retry();
    const stored = await store.getState();

    assert.equal(result.status, "idle");
    assert.deepEqual(api.calls, [{}]);
    assert.equal(stored.current, null);
    assert.deepEqual(stored.seenIds, [1, 2]);
    assert.equal(stored.lastId, 100);
    assert.equal(stored.exhausted, false);
    assert.deepEqual(stored.events.map((event) => event.type), [
      "empty",
      "fetch",
      "caught-up"
    ]);
  });
```

(e) Delete `"cursorless retry exhausts after three total duplicate-only pages"` (line 523) — the forward-pagination loop it covered no longer exists (replaced by single-page forward + explicit `loadArchive`).

(f) `"initialize preserves a retryable post-open state without fetching"` (line 701): `openCurrent` and `retry` are now forward. Change the two call assertions and the final `lastId`:
- line 721 `assert.deepEqual(api.calls, [{ lastId: 100 }]);` → `assert.deepEqual(api.calls, [{}]);`
- line 738 `assert.deepEqual(api.calls, [{ lastId: 100 }, { lastId: 100 }]);` → `assert.deepEqual(api.calls, [{}, {}]);`
- line 741 `assert.equal(retriedState.lastId, 200);` → `assert.equal(retriedState.lastId, 100);`

- [ ] **Step 2: Run the retry tests — watch them fail (current `retry` is still backward)**

Run: `node --test --test-name-pattern="retry|post-open" test/queueService.test.js`
Expected: FAIL on the edited tests (current `resume` uses backward fetch / overwrites `lastId`).

- [ ] **Step 3: Rewrite `retry()` to use a forward resume**

Replace the `resume` function (lines 303-323) with:

```js
  async function resumeForward(state, actionType) {
    if (state.current) {
      return resultFor(state);
    }

    if (state.backlog.length > 0) {
      const nextState = showNextBacklogItem(state, now);
      return resultFor(await save(nextState));
    }

    try {
      const fetched = await fetchNewerItems(state);
      const nextState = showForwardItems(fetched.state, fetched.items, now);
      return resultFor(await save(nextState));
    } catch (error) {
      return saveError(state, actionType, error);
    }
  }
```

And change the `retry()` action body (line 406) from `return resume(state, "retry");` to:

```js
        return resumeForward(state, "retry");
```

- [ ] **Step 4: Remove the now-dead backward-from-first-page code**

In `fetchUsableItems` (lines 223-256) delete the `startFromFirstPage` parameter and the `requestFirstPage` branches, leaving a backward-only loop:

```js
  async function fetchUsableItems(state) {
    let nextState = state;

    for (let attempt = 0; attempt < MAX_FETCH_PAGES_PER_ACTION; attempt += 1) {
      if (nextState.lastId === null) {
        break;
      }

      const requestedLastId = nextState.lastId;
      const fetched = await fetchNews({ lastId: requestedLastId });
      const remembered = rememberFetch(nextState, requestedLastId, fetched, now);
      nextState = remembered.state;

      if (remembered.items.length === 0) {
        break;
      }

      const items = dedupeItems(remembered.items, nextState);

      if (items.length > 0) {
        return { state: nextState, items };
      }

      if (nextState.lastId === null) {
        break;
      }
    }

    return { state: nextState, items: [] };
  }
```

Then delete the now-unused `fetchFirstPageItems` function (lines 262-264). Keep `fetchNextUsableItems` (line 258-260) as the thin wrapper used by `advance` (legacy) and `loadArchive`.

- [ ] **Step 5: Run the full suite — everything green**

Run: `node --test test/*.test.js`
Expected: all tests PASS.

- [ ] **Step 6: Syntax check**

Run: `npm run check`
Expected: no output (clean).

- [ ] **Step 7: Commit**

```bash
git add src/queueService.js test/queueService.test.js
git commit -m "feat: make retry a forward check; drop dead backward-from-first-page path

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: UI — three states + "Глубже в архив" button

Render Card / Fork / Archive-ended and wire the new action. There is no DOM test suite; verify with `npm run check` and a manual load.

**Files:**
- Modify: `src/newtab.js`

**Interfaces:**
- Consumes: `service.loadArchive()` (Task 2), `service.retry()`, `service.reset()`; existing `renderShell`, `createButton`, `renderCard`, `setBusy`, `runAction`.
- Produces: a `renderFork` renderer (current null & not exhausted, shows `Проверить новые` / `Глубже в архив` / `Сбросить` plus an error banner when present); a `renderArchiveEnded` renderer (current null & exhausted, shows `Проверить новые` / `Сбросить`); an `archive` click action.

- [ ] **Step 1: Replace `renderExhausted` and `renderRetryableIdle` (lines 136-160) with two new renderers**

```js
function renderArchiveEnded(state, error = null, busyMessage = "") {
  renderShell({
    title: "Вы прочитали всё, включая архив",
    meta: "Новых карточек нет. Можно проверить ещё раз позже.",
    status: busy ? busyMessage : null,
    error,
    actions: [
      createButton("Проверить новые", "retry", { primary: true }),
      createButton("Сбросить", "reset")
    ]
  });
}

function renderFork(state, error = null, busyMessage = "") {
  renderShell({
    title: "Вы прочитали всё свежее",
    meta: "Проверьте новые сверху или загляните глубже в архив.",
    status: busy ? busyMessage : null,
    error,
    actions: [
      createButton("Проверить новые", "retry", { primary: true }),
      createButton("Глубже в архив", "archive"),
      createButton("Сбросить", "reset")
    ]
  });
}
```

- [ ] **Step 2: Update `renderResult` (lines 162-183) to route the three states**

Replace the tail of `renderResult` (from `if (state.exhausted)` onward) with:

```js
  if (state.current) {
    renderCard(state, error, busyMessage);
    return;
  }

  if (state.exhausted) {
    renderArchiveEnded(state, error, busyMessage);
    return;
  }

  renderFork(state, error, busyMessage);
```

- [ ] **Step 3: Add the `archive` action to the click handler (lines 301-311)**

Add a branch before the `retry` branch:

```js
    } else if (action === "archive") {
      void runAction("Загружаю архив...", () => service.loadArchive());
    } else if (action === "retry") {
```

- [ ] **Step 4: Add `loadArchive` to the unavailable-service stub (lines 224-240)**

Add alongside the other stub methods:

```js
    async loadArchive() {
      return result;
    },
```

- [ ] **Step 5: Syntax check**

Run: `npm run check`
Expected: no output (clean).

- [ ] **Step 6: Manual smoke test**

Load the unpacked extension (`chrome://extensions` → Developer mode → Load unpacked → repo dir), open a new tab, and verify: a card shows; `Просмотрел` advances; after the backlog drains you reach the Fork screen with three buttons; `Глубже в архив` loads older items; `Проверить новые` reloads the top. Note the result in the commit body.

- [ ] **Step 7: Commit**

```bash
git add src/newtab.js
git commit -m "feat: render Card/Fork/Archive-ended states and wire archive button

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Open-repo docs — LICENSE, package.json metadata, CONTRIBUTING, SECURITY

**Files:**
- Create: `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`
- Modify: `package.json`

- [ ] **Step 1: Create `LICENSE` (MIT)**

```text
MIT License

Copyright (c) 2026 undevy-org

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 2: Update `package.json` metadata**

Replace the contents of `package.json` with:

```json
{
  "name": "dtf-newtab-queue-extension",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Manifest V3 new-tab extension that shows a manual one-card queue of DTF news, with forward catch-up and explicit archive paging.",
  "license": "MIT",
  "keywords": [
    "chrome-extension",
    "manifest-v3",
    "new-tab",
    "dtf"
  ],
  "repository": {
    "type": "git",
    "url": "https://github.com/undevy-org/dtf-newtab-queue.git"
  },
  "bugs": {
    "url": "https://github.com/undevy-org/dtf-newtab-queue/issues"
  },
  "homepage": "https://github.com/undevy-org/dtf-newtab-queue#readme",
  "scripts": {
    "test": "node --test test/*.test.js",
    "check": "find src -name '*.js' -print0 | xargs -0 -n1 node --check"
  }
}
```

- [ ] **Step 3: Verify the manifest/package tests still pass**

Run: `node --test test/manifest.test.js`
Expected: PASS (the manifest test does not assert `package.json`; this is a sanity check the JSON is valid).

Run: `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('ok')"`
Expected: `ok`.

- [ ] **Step 4: Create `CONTRIBUTING.md`**

```markdown
# Contributing

Thanks for your interest in improving DTF New Tab Queue.

## Requirements

- Node.js 20 or newer (the test and check scripts use the built-in test runner
  and `node --check`).
- No third-party dependencies — keep it that way unless there is a strong reason.

## Local development

1. Clone the repository.
2. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**,
   and select the repository directory.
3. Open a new tab to exercise the queue. Reload the extension after changes.

## Tests and checks

```bash
npm test       # node --test over test/*.test.js
npm run check  # node --check over every file in src/
```

Both must pass before opening a pull request.

## Conventions

- Render UI text only through DOM text nodes (`textContent`); never `innerHTML`.
- Any outbound URL must pass `isSafeDtfUrl` (HTTPS on `dtf.ru` or a subdomain)
  before it is opened.
- The persisted state schema is validated by `isQueueState`; if you add a field,
  update the validator and its tests.
- Follow the existing module boundaries: API client (`dtfApi.js`), URL safety
  (`dtfUrl.js`), persistence (`queueStore.js`), state machine (`queueService.js`),
  UI (`newtab.js`).

## Pull requests

- Keep changes focused; one logical change per PR.
- Add or update tests for behaviour changes.
- Update `CHANGELOG.md` under `[Unreleased]`.
```

- [ ] **Step 5: Create `SECURITY.md`**

```markdown
# Security Policy

## Supported versions

The latest released version receives security fixes. This is a small, single-purpose
browser extension; older versions are not maintained.

## Reporting a vulnerability

Please report security issues privately rather than opening a public issue.
Use GitHub's **Report a vulnerability** (Security Advisories) on the repository,
or contact the maintainer directly through their GitHub profile.

Include enough detail to reproduce the issue. You can expect an initial response
within a reasonable time, and coordinated disclosure once a fix is available.

## Scope

Relevant areas for this extension:

- Cross-site scripting via rendered news content.
- URL-validation bypasses that could open a non-`dtf.ru` destination.
- Leakage or corruption of locally persisted queue state.

The extension has no backend, no content scripts, no remote code, and no broad host
permissions; it only reads `https://api.dtf.ru/*` using the browser's existing DTF
session.
```

- [ ] **Step 6: Commit**

```bash
git add LICENSE package.json CONTRIBUTING.md SECURITY.md
git commit -m "docs: add LICENSE, SECURITY, CONTRIBUTING, and package metadata

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: README + CHANGELOG updates (last, after behaviour is final)

**Files:**
- Modify: `README.md`, `CHANGELOG.md`

- [ ] **Step 1: Update the Features list in `README.md`**

Replace the bullet `- Fetches another API page only when the local backlog is empty.` (line 13) with these two bullets:

```markdown
- Catches up on newer headlines automatically when the local backlog empties.
- Lets you step explicitly into older news with **Глубже в архив**, one batch at a time.
```

- [ ] **Step 2: Add a directional-navigation paragraph to "How It Works"**

After the existing "No request is made while an existing card is simply displayed…" paragraph (line 37), add:

```markdown
When the backlog empties, the extension fetches the **first** page again and shows
only headlines you have not seen yet — it does not crawl backward by default, so the
queue can reach a real end. From the end screen you can press **Проверить новые** to
re-check the top, or **Глубже в архив** to load one older page at a time. Forward
checks never move the archive cursor, so stepping into the archive resumes from where
you left off.
```

- [ ] **Step 3: Strengthen the privacy note in `README.md`**

After the line `API requests include DTF credentials so the extension can use the browser's signed-in DTF session.` (line 46), append:

```markdown
Requests are sent with `credentials: "include"`, so they carry your existing DTF
session cookies to `api.dtf.ru`; the extension never reads or copies those cookies.
```

- [ ] **Step 4: Add a documentation links section near the end of `README.md`**

Before the `## Compatibility` section, add:

```markdown
## Documentation

- [Changelog](CHANGELOG.md)
- [Architecture](docs/architecture.md)
- [Privacy](docs/privacy.md)
- [Contributing](CONTRIBUTING.md)
- [Security Policy](SECURITY.md)
- [License](LICENSE) (MIT)
```

- [ ] **Step 5: Record the work in `CHANGELOG.md` under `[Unreleased]`**

Replace the `### Added` block under `## [Unreleased]` with:

```markdown
### Added

- This changelog.
- `Глубже в архив` action: explicit, one-batch-per-press paging into older news.
- LICENSE (MIT), `CONTRIBUTING.md`, `SECURITY.md`, and `package.json` repository
  metadata.

### Changed

- When the backlog empties, the queue now catches up on **newer** items (forward)
  instead of crawling endlessly backward; the feed can now reach a real end.
- `Проверить новые` re-checks the newest page; forward checks no longer move the
  archive cursor.
```

- [ ] **Step 6: Final full verification**

Run: `node --test test/*.test.js && npm run check`
Expected: all tests PASS, check clean.

- [ ] **Step 7: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: document directional queue UX and update changelog

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review Notes

- **Spec coverage:** Forward catch-up + cursor preservation → Tasks 1, 3. Explicit one-batch archive → Task 2. Three UI states + merged retryable-idle → Task 4. `exhausted` redefined as archive-end → enforced by `showForwardItems` (never sets it true) vs `showItems` (sets it on empty backward). All five doc artifacts → Tasks 5, 6. Known-limitation (single forward page) is realized by `fetchNewerItems` doing exactly one `fetchNews({})`.
- **Seed-vs-preserve:** `rememberForwardFetch` seeds `lastId` only when it is `null`, so first init and post-failure retry reach the archive, while established queues keep their archive position. This is the crux of the bug fix and is asserted in Task 1 Step 1 and Task 3 Step 1(a).
- **Type consistency:** `fetchNewerItems` / `showForwardItems` / `loadArchive` / `resumeForward` names are used identically across tasks. Event types: `"caught-up"` (forward-empty), `"shown"`, `"empty"` (archive-end), `"fetch"`, `"dismissed"`, `"opened"`, `"error"` — all non-empty strings accepted by `isQueueEvent`.
- **No schema change:** no new persisted fields; `isQueueState`/`queueStore.test.js` untouched.
```
