# Privacy

## Data Sent

The extension sends news-feed requests only to:

```text
https://api.dtf.ru/v2.10/news
```

Requests use `credentials: "include"` so DTF can apply the browser's existing signed-in session. The extension does not read, inspect, copy, or export browser cookies.

Opening a card navigates a new tab to the validated DTF article URL selected from the API response.

## Data Stored

The extension stores the following data in `chrome.storage.local`:

- the current queue item;
- queued items from fetched batches;
- IDs of processed items;
- the DTF pagination cursor;
- timestamps and a bounded diagnostic event log.

This state remains on the local browser profile. There is no synchronization service, project backend, telemetry, or analytics endpoint.

## Background Activity

There is no background polling. Network requests occur only:

- on the first initialization;
- when an explicit action needs the next API page;
- when the user retries or resets the queue.

Removing the extension through the browser's extension manager removes its local extension storage according to the browser's normal extension-data behavior.
