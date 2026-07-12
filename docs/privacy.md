# Privacy

## Data Sent

The extension sends news-feed requests only to:

```text
https://api.dtf.ru/v2.10/news
```

Requests use `credentials: "include"` so DTF can apply the browser's existing signed-in session. The extension does not read, inspect, copy, or export browser cookies.

Opening a card navigates a new tab to the validated DTF article URL selected from the API response.

For favorites, the extension may ask Chromium for a site's favicon through the
Manifest V3 `_favicon` endpoint. Custom image URLs, if configured by the user,
are loaded by the new tab page so they can be displayed as tile icons.

## Data Stored

The extension stores queue reading-progress in `chrome.storage.local`, scoped
to this browser profile only:

- the current queue item;
- queued items from fetched batches;
- IDs of processed items;
- the DTF pagination cursor;
- timestamps and a bounded diagnostic event log.

The extension stores user-created favorite links in `chrome.storage.sync`:

- saved URLs;
- labels;
- domains;
- icon mode and optional custom image URLs;
- tile background colors and tile size;
- creation and update timestamps.

`chrome.storage.sync` is Chrome's own built-in sync feature, not a project-run
service: if the browser is signed into a Google account with sync enabled,
favorites follow the user to their other signed-in Chromium browsers running
this same extension. There is no synchronization service, project backend,
telemetry, or analytics endpoint operated by this extension — sync, when it
happens, is entirely Chrome's own infrastructure. If sync is off or
unavailable, favorites still work locally, just without cross-device
propagation.

## Background Activity

There is no background polling. Network requests occur only:

- on the first initialization;
- when an explicit action needs the next API page;
- when the user retries or resets the queue.

Removing the extension through the browser's extension manager removes its local extension storage according to the browser's normal extension-data behavior.
