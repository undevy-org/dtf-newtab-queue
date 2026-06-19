# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
