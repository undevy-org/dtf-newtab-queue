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
