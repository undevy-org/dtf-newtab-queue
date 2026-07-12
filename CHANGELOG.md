# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Favorites now sync across devices via `chrome.storage.sync`: they follow
  you to any other Chromium browser signed into the same Google account
  (running this same extension) with sync enabled. Storage is sharded across
  a `dtfFavoritesMeta` order key plus one `dtfFavorite:<id>` key per favorite,
  since `chrome.storage.sync` caps a single key at 8KB — too small for a full
  200-item list in one blob.
- A one-time migration moves any favorites already saved in
  `chrome.storage.local` (the pre-sync format) into the new sync-backed
  storage the first time the extension loads after upgrading, without
  touching the legacy data until the sync write has succeeded.
- `manifest.json` now pins a fixed `key`, so two separate "Load unpacked"
  installs of this repo (e.g. on two different machines) share the same
  extension id — a prerequisite for `chrome.storage.sync` to actually
  propagate favorites between them.

### Changed

- Queue reading-progress remains on `chrome.storage.local` only; it is not
  part of this sync.

## [0.3.0] - 2026-07-12

### Added

- The favorites bar is now a viewport-pinned quick-links toolbar: a fixed
  glass bar at the top of the new tab that stays put regardless of the news
  card's height, with a single horizontally-scrolling row of tiles bounded
  against the 200-item cap.
- Favorite management is consolidated into a gear-opened settings panel, the
  only management entry point. The inline `+` add tile is gone; add, edit,
  delete, and reorder all live in the panel, which closes on `Готово`,
  `Escape`, or a click outside it and returns focus to the gear.
- Favorite tiles are now transparent surfaces with an accent border derived
  from the stored color, lightness-normalized so it stays visible on both
  light and dark backgrounds.
- Favorite tiles support an optional `tileSize` (`square` / `wide`) field,
  validated and defaulted end-to-end and rendered as a wider tile in the
  toolbar when set.
- Toolbar and settings-panel chrome (gear, move/edit/delete, size toggle)
  now render through a small locally-vendored Lucide icon set (`src/icons.js`,
  ISC-licensed) instead of text glyphs.

### Changed

- Extracted shared validation/clone helpers (`src/storeUtils.js`) and
  favorites constants (`src/favoritesShared.js`), removing duplication
  between `favoritesStore.js`, `favoritesService.js`, `favoriteIcon.js`, and
  `queueStore.js`.
- Favicon URLs are now built from `chrome.runtime.getURL("/_favicon/")`
  rather than a hand-assembled `chrome-extension://<id>/…` string, and each
  rendered icon records its source (`favicon` / `custom` / `letter`).
  Auto-accent color extraction now runs after the tile is shown, so a slow
  favicon fetch no longer blocks a new tile from appearing.
- The stored favorite `backgroundColor` is re-interpreted as an accent color
  at render time; the persisted schema is unchanged (still version 1, source
  values still `auto` / `manual`).
- The UI accent switched from blue to a theme-aware black/white.
- The favorite add/edit form is redesigned into a single labeled,
  icon-buttoned component.
- The toolbar now hugs its content width instead of stretching, and the
  settings panel stacks above it instead of overlaying it.
- The literal "DTF" eyebrow label is removed from the news card.

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
- The mutation-lock unit test no longer assigns the read-only
  `globalThis.navigator` global, so the suite passes on current Node LTS as
  well as Node 20; `package.json` now pins `engines.node` to `>= 20`.
- Canvas-based accent-color auto-sampling is now skipped for custom icon
  URLs.
- Dropped a dead `.favorite-tile:hover` CSS selector and a dead form-input
  `min-width` rule; form row labels are now linked to their inputs via
  `aria-labelledby`.

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

[Unreleased]: https://github.com/undevy-org/dtf-newtab-queue/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/undevy-org/dtf-newtab-queue/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/undevy-org/dtf-newtab-queue/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/undevy-org/dtf-newtab-queue/releases/tag/v0.1.0
