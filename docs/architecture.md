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
