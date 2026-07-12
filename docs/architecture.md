# Architecture

## Overview

DTF New Tab Queue is an API-first Manifest V3 extension with no service worker. The new tab page owns rendering and calls a small state-machine service. State is persisted in `chrome.storage.local`, so closing the page does not discard the queue.

## Components

| File | Responsibility |
| --- | --- |
| `src/dtfApi.js` | Calls the DTF news endpoint and normalizes responses. |
| `src/dtfUrl.js` | Accepts only safe HTTPS URLs on `dtf.ru` or its subdomains. |
| `src/queueStore.js` | Validates, reads, and writes persisted queue state. |
| `src/queueService.js` | Implements initialization, advancement, pagination, retry, reset, and event logging. |
| `src/favoritesStore.js` | Validates, reads, and writes persisted favorites state, sharded across `chrome.storage.sync` keys; also holds the legacy-to-sync migration. |
| `src/favoritesService.js` | Implements add/update/delete/move with input normalization, all serialized through a mutation lock. |
| `src/newtab.js` | Renders UI states and connects buttons to the service. |

## State Model

The extension stores one object under `dtfQueueState`:

```js
{
  current: QueueItem | null,
  backlog: QueueItem[],
  seenIds: number[],
  lastId: number | null,
  initializedAt: string,
  updatedAt: string,
  exhausted: boolean,
  events: QueueEvent[]
}
```

The event log is diagnostic only and is capped at 500 entries.

## Main Flow

1. `initialize()` reads existing valid state.
2. A pristine store triggers the first DTF API request.
3. The first item becomes `current`; the rest become `backlog`.
4. **Просмотрел** marks the current item as seen and advances.
5. **Перейти** opens the validated DTF URL, records the item as seen, and advances.
6. When the backlog is empty, the service fetches the **first** page (forward catch-up)
   and shows only items the user has not yet seen. This never moves `lastId`, so the
   archive cursor stays where it was. The queue can reach a real end.
7. **Глубже в архив** (`loadArchive`) loads one older page per press, advancing
   `lastId`. If the page is empty or carries no cursor, `exhausted` is set to `true`
   and the Archive-ended screen is shown.

When `loadArchive` pages through duplicates it checks at most three non-empty API pages per press before giving up. An empty page or missing cursor ends the backward search.

## Favorites Storage

Favorites sync across devices via `chrome.storage.sync`, which caps a single
key at 8KB — too small to hold all 200 possible favorites in one blob. Storage
is sharded instead:

- `dtfFavoritesMeta` — `{ version, order: [id, ...], createdAt, updatedAt }`,
  the authoritative display order (never trust `chrome.storage`'s object-key
  iteration order).
- `` `dtfFavorite:<id>` `` — one key per favorite item.

`getState()` tolerates a `meta.order` entry whose item key hasn't propagated
from another device yet — it filters that entry out rather than discarding
the whole list, self-healing on the next successful write. `setState()`
rewrites the meta key and every current item in a single batched
`storageArea.set()` call (one write operation regardless of key count), then
removes the per-item keys of any favorites that were deleted.

A one-time `migrateLegacyFavorites()` step (invoked from `newtab.js` on
bootstrap, before the first favorites read) moves any pre-existing
`chrome.storage.local` favorites — the pre-sync single-blob format under key
`dtfFavorites` — into this sharded sync layout, clearing the legacy key only
after the sync write succeeds. If two machines each already had independent
local favorites before sync was enabled, migrating both is not a merge:
whichever machine's migration write lands last wins.

For two separate "Load unpacked" installs to be treated as the same extension
(a prerequisite for `chrome.storage.sync` to propagate between them),
`manifest.json` pins a fixed `key` so the extension id is deterministic
regardless of install path.

## Error Semantics

- A failed viewed action keeps the current card unchanged.
- Once an article has opened successfully, that action is irreversible. If the subsequent forward catch-up then fails, the opened item stays seen and retry performs a fresh forward check (first page) without using `lastId`.
- A failed reset preserves the previous queue.
- A retryable state is distinct from an exhausted queue, so the UI does not incorrectly claim that everything was read.

## Concurrency

Multiple new tab pages can exist at once. Mutating operations are serialized with the Web Locks API using one extension-wide lock name. A promise-chain fallback provides deterministic behavior in environments without Web Locks and in Node.js tests.

## Security Boundaries

- News titles are rendered with DOM text nodes, never `innerHTML`.
- API and persisted item URLs must use HTTPS and belong to `dtf.ru` or a subdomain.
- URLs are validated again immediately before opening a tab.
- Persisted state is schema-validated before use; malformed state falls back to a clean initial state.
- The extension has no content scripts, remote code, background worker, or broad host permissions.
