# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Favorites add/update/delete/move no longer race each other: mutations are
  now serialized through the same Web Locks-based mutation lock already used
  by the queue (`src/mutationLock.js`), so two overlapping actions can no
  longer silently drop each other's write.
- The favorites bar now locks while any mutation is in flight, so a slow
  auto-color fetch can no longer be interrupted by navigating to a different
  item's edit form, an open edit form's unsaved input can no longer be wiped
  by a sibling action (e.g. reordering another tile), and deleting an item
  mid-flight no longer surfaces a spurious "Favorite not found" error.
- Bare `host:port` favorite URLs without a dot in the host (e.g. `router:8080`)
  are no longer misclassified as having a URL scheme and rejected.
- Adding a favorite past the 200-item cap now fails with a clear message
  instead of a generic "Invalid favorites state" error.
- The favorites bar bootstrap no longer depends on the queue widget's `#app`
  element being present.

### Changed

- Extracted shared validation/clone helpers (`src/storeUtils.js`) and
  favorites constants (`src/favoritesShared.js`), removing duplication
  between `favoritesStore.js`, `favoritesService.js`, `favoriteIcon.js`, and
  `queueStore.js`.

## [0.2.0] - 2026-06-19

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
- `seenIds` is now bounded to the 500 newest article ids (`MAX_SEEN_IDS`) instead
  of growing without limit. The cap keeps the highest (newest) ids — those a
  forward check dedups against — and drops the deepest-archive ids; legacy
  oversized states are trimmed on read rather than discarded.

## [0.1.0] - 2026-06-18

### Added

- Manifest V3 new-tab extension that shows one DTF headline at a time.
- `Просмотрел` action that marks the current card as seen and advances.
- `Перейти` action that opens the validated DTF article and advances.
- DTF API client with response normalization (`src/dtfApi.js`).
- Safe-URL validation restricted to `dtf.ru` and subdomains (`src/dtfUrl.js`).
- Persistent, schema-validated queue state in `chrome.storage.local`
  (`src/queueStore.js`).
- Queue state machine with bounded per-action pagination, duplicate
  filtering, retry, reset, and a capped diagnostic event log
  (`src/queueService.js`).
- Cross-tab serialization via the Web Locks API with a promise-chain
  fallback.
- Unit test suite (53 tests) covering API normalization, pagination,
  deduplication, persistence validation, retry/reset, serialization,
  and URL safety.
- Architecture and privacy documentation under `docs/`.

[Unreleased]: https://github.com/undevy-org/dtf-newtab-queue/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/undevy-org/dtf-newtab-queue/releases/tag/v0.1.0
