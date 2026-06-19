# Design: Directional Queue (forward/archive) + Open-Repo Docs

Date: 2026-06-19
Status: Approved (pending spec review)

## Problem

The queue uses DTF's `lastId` cursor as its only "load more" mechanism. `lastId`
paginates **backward** (toward older articles), so every time the local backlog
empties the extension fetches an older page. Because DTF's archive is effectively
infinite going back, the queue never ends — it tunnels endlessly into the past and
never surfaces genuinely new news. The `exhausted` end-state is practically
unreachable, and there is no path that fetches news newer than the first item ever
seen except `reset`, which wipes all history.

Root cause: a single `lastId` cursor is overwritten by **every** fetch, and the
default advance action drives it backward.

This design splits navigation into two explicit directions and adds the open-source
documentation the repository currently lacks.

## Goals

1. Default behavior catches up on **new** news; the queue can honestly end.
2. Going into the archive (backward) is an **explicit, one-batch-per-press** action.
3. The forward direction never disturbs the archive cursor.
4. Ship standard open-repo docs: LICENSE (MIT), CONTRIBUTING, SECURITY,
   `package.json` metadata, README updates.

## Non-Goals (YAGNI)

- Forward pagination to close gaps when more than one page of new items appeared.
  "Проверить новые" fetches only the first page; middle items in a large gap are
  not recovered. Documented as a known limitation.
- A persistent "archive mode". Each archive step is a single explicit press.
- ~~Capping the unbounded `seenIds` array. It interacts with forward dedup (capping
  could resurface old dismissed items) and is tracked as a separate follow-up.~~
  Done (2026-06-19): `seenIds` is bounded to the 500 newest (highest) ids via
  `MAX_SEEN_IDS` / `capSeenIds` in `src/queueStore.js`. Keeping the top-N by id
  value (not insertion order) avoids resurfacing newest items at the top, since a
  forward fetch returns the highest ids; deepest-archive ids are dropped safely.
- A separate `firstSeenId` top cursor. Forward dedup via `seenIds` is sufficient.

## Part 1 — Directional Queue (feature)

### State model

No new persisted fields. The existing `exhausted: boolean` is redefined to mean
**"the archive (backward) direction has ended"** — set true only when a backward
fetch returns an empty page or there is no `lastId` cursor.

Three UI states, derived from `current` and `exhausted`:

| State | Condition | Buttons |
| --- | --- | --- |
| Card | `current != null` | `Просмотрел` · `Перейти` (primary) |
| Fork | `current == null && exhausted == false` | `Проверить новые` (primary) · `Глубже в архив` · `Сбросить` |
| Archive ended | `current == null && exhausted == true` | `Проверить новые` (primary) · `Сбросить` |

The former standalone "retryable idle" screen is merged into **Fork**: when a
result carries `error`, the Fork screen additionally renders the error banner.
The button set is unchanged by the presence of an error.

### Two independent cursors (the fix)

- **`lastId`** — the archive cursor (toward older items). Updated **only** by the
  "Глубже в архив" (backward) action.
- **Forward fetch** ("Проверить новые" and the auto-catch-up on empty backlog) —
  calls `fetchNews({})` (first page, no `lastId`), dedupes against `seenIds` plus
  the current item and backlog, and **must preserve the existing `state.lastId`**.

Critical: today `rememberFetch` overwrites `state.lastId` with each fetched page's
`lastId`. A forward fetch must NOT do this, otherwise the newest page's bottom
cursor would reset the archive position back toward the top and lose the user's
place in the archive. Backward fetch keeps the existing overwrite behavior.

Implementation note: introduce a forward-specific helper (e.g.
`fetchNewerItems(state)`) that records a `fetch` event for diagnostics but returns
a state with `lastId` unchanged. The existing `fetchUsableItems` /
`fetchNextUsableItems` (which advance `lastId`) becomes the backward-only path used
by "Глубже в архив".

### Flow

1. `Просмотрел` / `Перейти`, backlog non-empty → show next backlog item (unchanged).
2. `Просмотрел` / `Перейти`, backlog empty → **forward catch-up**. If new usable
   items exist → show them (first becomes `current`, rest `backlog`). If none →
   `current = null`, `exhausted = false` → Fork state.
3. `Глубже в архив` → backward fetch by `lastId`, delivering one batch of usable
   items per press. The internal bounded duplicate-skip loop
   (`MAX_FETCH_PAGES_PER_ACTION = 3`) is retained so a press skips all-duplicate
   pages but still yields one usable batch. `lastId` advances deeper. After the
   batch is consumed → Fork again.
4. `Глубже в архив` returns an empty page or has no cursor → `exhausted = true` →
   Archive-ended state.
5. `Проверить новые` = manual forward fetch (same as step 2). Available in both
   Fork and Archive-ended states (fresh news may have appeared). A successful
   forward fetch that finds items clears `exhausted` back to `false`.

### Service API changes (`src/queueService.js`)

- `markViewed()` / `openCurrent()`: on empty backlog, call forward catch-up instead
  of `fetchNextUsableItems`.
- New action `loadArchive()`: backward one-batch fetch (current
  `fetchNextUsableItems` logic); on empty/no-cursor sets `exhausted = true`.
- `retry()`: re-runs the forward fetch (acts as "Проверить новые").
- `reset()`: unchanged (full re-init from first page).
- `initialize()`: unchanged (first item current, rest backlog, `lastId` seeded from
  first page — the archive cursor correctly starts at the bottom of the newest page).

### UI changes (`src/newtab.js`)

- Render the three states above. Add `Глубже в архив` (action `archive`) wired to
  `service.loadArchive()`.
- Merge `renderRetryableIdle` into the Fork renderer; show the error banner when
  `result.error` is present.
- Update button labels/titles for the Fork and Archive-ended screens.

### Error semantics (preserved)

- A failed `Просмотрел` keeps the current card unchanged.
- An opened article stays seen even if the subsequent forward fetch fails; the Fork
  screen lets the user retry.
- A failed forward/backward fetch lands on the Fork screen with an error banner; the
  archive cursor is not corrupted because forward fetches never touch `lastId`.

### Testing (TDD)

New tests:

- Forward fetch preserves `state.lastId` (archive cursor untouched).
- `loadArchive` advances `lastId` by one batch and shows older items.
- `exhausted` becomes true only via an empty/no-cursor backward fetch, never via a
  forward fetch that finds nothing.
- A forward fetch that finds items clears `exhausted`.
- Rendering of all three UI states, including Fork-with-error.

Existing tests that assert `markViewed` on an empty backlog triggers a backward
(`lastId`) fetch are rewritten to the new semantics (forward catch-up by default;
backward only via `loadArchive`). This is an expected, scoped change and is part of
the implementation plan.

## Part 2 — Open-Repo Documentation

| File | Content |
| --- | --- |
| `LICENSE` | MIT, copyright `2026 undevy-org`. |
| `package.json` | Add `license: "MIT"`, `repository`, `bugs`, `homepage` (→ `undevy-org/dtf-newtab-queue`), `keywords`, fuller `description`. |
| `CONTRIBUTING.md` | Node 20+ requirement; `npm test` and `npm run check`; `src/` layout; load-unpacked dev loop; conventions (textContent-only rendering, HTTPS+`dtf.ru` URL validation); PR flow. |
| `SECURITY.md` | Private disclosure channel (not a public issue); in-scope areas (XSS, URL validation, storage leakage); supported versions. |
| `README.md` | Add a `credentials: "include"` note (requests carry the browser's DTF session); document the two directional buttons (synced with the final UX); link CHANGELOG, LICENSE, CONTRIBUTING, SECURITY. |

README directional-button copy is written **last**, after the feature lands, so docs
do not drift from behavior.

## Build Order

1. Phase 1 — feature, via TDD (state model → service → UI), updating affected tests.
2. Phase 2 — documentation (LICENSE, package.json metadata, CONTRIBUTING, SECURITY,
   then README updates including the directional buttons).
3. Update `CHANGELOG.md` `[Unreleased]` with both parts.
