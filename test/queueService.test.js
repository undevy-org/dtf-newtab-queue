import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_SEEN_IDS,
  createInitialState,
  createMemoryStorageArea,
  createQueueStore
} from "../src/queueStore.js";
import { createQueueService } from "../src/queueService.js";

const NOW = "2026-06-17T10:00:00.000Z";
const UNSAFE_DTF_URLS = [
  "javascript:alert(1)",
  "http://dtf.ru/news/1",
  "https://dtf.ru.evil.example/news/1",
  "https://.dtf.ru/news/1",
  "https://user:pass@dtf.ru/news/1",
  "https://dtf.ru:444/news/1",
  "not a URL"
];

function item(id, overrides = {}) {
  return {
    id,
    title: `News ${id}`,
    url: `https://dtf.ru/news/${id}`,
    date: 1781691000 + id,
    sourceBatchLastId: null,
    ...overrides
  };
}

function stateWith(overrides = {}) {
  return {
    ...createInitialState("2026-06-17T09:00:00.000Z"),
    ...overrides
  };
}

function createApi(batches) {
  const calls = [];

  return {
    calls,
    async fetchNews(options = {}) {
      calls.push(options);
      const next = batches.shift();

      if (next instanceof Error) {
        throw next;
      }

      if (typeof next === "function") {
        return next(options);
      }

      return next;
    }
  };
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

async function createHarness({ initialState = null, batches = [], openUrl } = {}) {
  const storageArea = createMemoryStorageArea();
  const store = createQueueStore(storageArea, {
    now: () => NOW
  });

  if (initialState) {
    await store.setState(initialState);
  }

  const api = createApi(batches);
  const service = createQueueService({
    store,
    fetchNews: api.fetchNews,
    openUrl,
    now: () => NOW
  });

  return { api, service, store };
}

describe("queueService", () => {
  it("first initialize fetches the first batch and stores current, backlog, and lastId", async () => {
    const { api, service, store } = await createHarness({
      batches: [{ items: [item(1), item(2), item(3)], lastId: 300 }]
    });

    const result = await service.initialize();
    const stored = await store.getState();

    assert.equal(result.status, "ready");
    assert.equal(result.error, null);
    assert.deepEqual(api.calls, [{}]);
    assert.equal(stored.current.id, 1);
    assert.deepEqual(stored.backlog.map((newsItem) => newsItem.id), [2, 3]);
    assert.deepEqual(stored.seenIds, []);
    assert.equal(stored.lastId, 300);
    assert.equal(stored.exhausted, false);
    assert.equal(stored.updatedAt, NOW);
    assert.deepEqual(stored.events.map((event) => event.type), [
      "init",
      "fetch",
      "shown"
    ]);
  });

  it("initialize returns an existing current item without fetching", async () => {
    const { api, service } = await createHarness({
      initialState: stateWith({ current: item(9), lastId: 900 })
    });

    const result = await service.initialize();

    assert.equal(result.status, "ready");
    assert.equal(result.state.current.id, 9);
    assert.deepEqual(api.calls, []);
  });

  it("initialize preserves a backlog-only state without fetching or showing it", async () => {
    const initialState = stateWith({
      backlog: [item(8), item(9)],
      seenIds: [7],
      lastId: 100
    });
    const { api, service, store } = await createHarness({
      initialState,
      batches: [{ items: [item(10)], lastId: 200 }]
    });

    const result = await service.initialize();
    const stored = await store.getState();

    assert.equal(result.status, "idle");
    assert.deepEqual(api.calls, []);
    assert.deepEqual(result.state, initialState);
    assert.deepEqual(stored, initialState);
  });

  it("markViewed advances through backlog without fetching", async () => {
    const { api, service, store } = await createHarness({
      initialState: stateWith({
        current: item(1),
        backlog: [item(2), item(3)],
        lastId: 300
      })
    });

    const result = await service.markViewed();
    const stored = await store.getState();

    assert.equal(result.status, "ready");
    assert.equal(result.error, null);
    assert.deepEqual(api.calls, []);
    assert.equal(stored.current.id, 2);
    assert.deepEqual(stored.backlog.map((newsItem) => newsItem.id), [3]);
    assert.deepEqual(stored.seenIds, [1]);
    assert.equal(stored.lastId, 300);
    assert.equal(stored.exhausted, false);
    assert.deepEqual(stored.events.map((event) => event.type), [
      "dismissed",
      "shown"
    ]);
  });

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

  it("markViewed logs dismissal before pagination fetch and showing", async () => {
    const { api, service, store } = await createHarness({
      initialState: stateWith({
        current: item(1),
        lastId: 100
      }),
      batches: [{ items: [item(2)], lastId: 200 }]
    });

    await service.markViewed();
    const stored = await store.getState();

    assert.deepEqual(api.calls, [{}]);
    assert.deepEqual(stored.events.map((event) => event.type), [
      "dismissed",
      "fetch",
      "shown"
    ]);
  });

  it("markViewed reaches the fork (not exhausted) when no newer items exist", async () => {
    const { api, service, store } = await createHarness({
      initialState: stateWith({
        current: item(1),
        lastId: 100
      }),
      batches: [
        { items: [item(1)], lastId: 900 },
        { items: [], lastId: null }
      ]
    });

    const result = await service.markViewed();
    const stored = await store.getState();

    assert.equal(result.status, "idle");
    assert.deepEqual(api.calls, [{}, { lastId: 900 }]);
    assert.equal(stored.current, null);
    assert.deepEqual(stored.seenIds, [1]);
    assert.equal(stored.lastId, 100);
    assert.equal(stored.exhausted, false);
    assert.deepEqual(stored.events.map((event) => event.type), [
      "dismissed",
      "fetch",
      "fetch",
      "caught-up"
    ]);
  });

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

  it("markViewed pages past a full page of duplicates to find newer items further forward", async () => {
    const { api, service, store } = await createHarness({
      initialState: stateWith({
        current: item(1),
        seenIds: [2, 3],
        lastId: 100
      }),
      batches: [
        { items: [item(1), item(2), item(3)], lastId: 400 },
        { items: [item(4), item(5)], lastId: 500 }
      ]
    });

    const result = await service.markViewed();
    const stored = await store.getState();

    assert.equal(result.status, "ready");
    assert.deepEqual(api.calls, [{}, { lastId: 400 }]);
    assert.equal(stored.current.id, 4);
    assert.deepEqual(stored.backlog.map((newsItem) => newsItem.id), [5]);
    assert.deepEqual(stored.seenIds, [2, 3, 1]);
    assert.equal(stored.lastId, 100);
    assert.equal(stored.exhausted, false);
  });

  it("markViewed logs the actual cursor requested by each forward-scan page", async () => {
    const { service, store } = await createHarness({
      initialState: stateWith({
        current: item(1),
        seenIds: [2, 3],
        lastId: 100
      }),
      batches: [
        { items: [item(1), item(2), item(3)], lastId: 400 },
        { items: [item(4), item(5)], lastId: 500 }
      ]
    });

    await service.markViewed();
    const stored = await store.getState();

    const fetchEvents = stored.events.filter((event) => event.type === "fetch");
    assert.deepEqual(
      fetchEvents.map((event) => event.details.requestedLastId),
      [null, 400]
    );
  });

  it("markViewed persists the dismissed transition while pagination is pending", async () => {
    const fetchStarted = createDeferred();
    const pendingBatch = createDeferred();
    const { service, store } = await createHarness({
      initialState: stateWith({
        current: item(1),
        lastId: 100
      }),
      batches: [() => {
        fetchStarted.resolve();
        return pendingBatch.promise;
      }]
    });

    const markViewedPromise = service.markViewed();
    await fetchStarted.promise;
    const pendingState = await store.getState();

    assert.equal(pendingState.current, null);
    assert.deepEqual(pendingState.backlog, []);
    assert.deepEqual(pendingState.seenIds, [1]);
    assert.equal(pendingState.lastId, 100);
    assert.equal(pendingState.exhausted, false);
    assert.deepEqual(pendingState.events.map((event) => event.type), ["dismissed"]);

    pendingBatch.reject(new Error("network down"));
    const result = await markViewedPromise;
    const failedState = await store.getState();

    assert.equal(result.status, "error");
    assert.equal(failedState.current, null);
    assert.deepEqual(failedState.seenIds, [1]);
    assert.equal(failedState.lastId, 100);
    assert.deepEqual(failedState.events.map((event) => event.type), [
      "dismissed",
      "error"
    ]);
  });

  it("retry shows the next backlog item without fetching when current is empty", async () => {
    const { api, service, store } = await createHarness({
      initialState: stateWith({
        current: null,
        backlog: [item(8), item(9)],
        exhausted: true,
        seenIds: [7],
        lastId: 100
      }),
      batches: [{ items: [item(7), item(8), item(9)], lastId: 900 }]
    });

    const result = await service.retry();
    const stored = await store.getState();

    assert.equal(result.status, "ready");
    assert.deepEqual(api.calls, []);
    assert.equal(stored.current.id, 8);
    assert.deepEqual(stored.backlog.map((newsItem) => newsItem.id), [9]);
    assert.deepEqual(stored.seenIds, [7]);
    assert.equal(stored.lastId, 100);
    assert.equal(stored.exhausted, false);
    assert.deepEqual(stored.events.map((event) => event.type), ["shown"]);
  });

  it("reaches the fork after three duplicate-only forward pages, archive cursor untouched", async () => {
    const { api, service, store } = await createHarness({
      initialState: stateWith({
        current: item(1),
        seenIds: [2, 3, 4, 5, 6, 7],
        lastId: 100
      }),
      batches: [
        { items: [item(1), item(2), item(3)], lastId: 400 },
        { items: [item(4), item(5)], lastId: 500 },
        { items: [item(6), item(7)], lastId: 600 },
        { items: [item(8)], lastId: 800 }
      ]
    });

    const result = await service.markViewed();
    const stored = await store.getState();

    assert.equal(result.status, "idle");
    assert.deepEqual(api.calls, [{}, { lastId: 400 }, { lastId: 500 }]);
    assert.equal(stored.current, null);
    assert.deepEqual(stored.backlog, []);
    assert.deepEqual(stored.seenIds, [2, 3, 4, 5, 6, 7, 1]);
    assert.equal(stored.lastId, 100);
    assert.equal(stored.exhausted, false);
    assert.equal(stored.events.at(-1).type, "caught-up");
  });

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

  it("retry fetches the first page after initial fetch failure without resetting history", async () => {
    const { api, service, store } = await createHarness({
      batches: [
        new Error("network down"),
        { items: [item(1), item(2)], lastId: 200 }
      ]
    });

    const initializeResult = await service.initialize();
    const failedState = await store.getState();
    const retryResult = await service.retry();
    const stored = await store.getState();

    assert.equal(initializeResult.status, "error");
    assert.equal(retryResult.status, "ready");
    assert.deepEqual(api.calls, [{}, {}]);
    assert.equal(stored.current.id, 1);
    assert.deepEqual(stored.backlog.map((newsItem) => newsItem.id), [2]);
    assert.deepEqual(stored.seenIds, failedState.seenIds);
    assert.equal(stored.initializedAt, failedState.initializedAt);
    assert.deepEqual(
      stored.events.slice(0, failedState.events.length),
      failedState.events
    );
    assert.deepEqual(stored.events.map((event) => event.type), [
      "error",
      "fetch",
      "shown"
    ]);
  });

  it("retry checks the first page from an exhausted null cursor and deduplicates seen items", async () => {
    const initialState = stateWith({
      seenIds: [1],
      lastId: null,
      exhausted: true,
      events: [
        {
          type: "empty",
          at: "2026-06-17T09:00:00.000Z",
          details: { reason: "no-usable-items" }
        }
      ]
    });
    const { api, service, store } = await createHarness({
      initialState,
      batches: [{ items: [item(1), item(2), item(3)], lastId: 300 }]
    });

    const result = await service.retry();
    const stored = await store.getState();

    assert.equal(result.status, "ready");
    assert.deepEqual(api.calls, [{}]);
    assert.equal(stored.current.id, 2);
    assert.deepEqual(stored.backlog.map((newsItem) => newsItem.id), [3]);
    assert.deepEqual(stored.seenIds, [1]);
    assert.equal(stored.initializedAt, initialState.initializedAt);
    assert.equal(stored.lastId, 300);
    assert.equal(stored.exhausted, false);
    assert.deepEqual(stored.events.map((event) => event.type), [
      "empty",
      "fetch",
      "shown"
    ]);
  });

  it("cursorless retry pages forward until it finds new items or the feed truly ends", async () => {
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
      batches: [
        { items: [item(1), item(2)], lastId: 100 },
        { items: [], lastId: null }
      ]
    });

    const result = await service.retry();
    const stored = await store.getState();

    assert.equal(result.status, "idle");
    assert.deepEqual(api.calls, [{}, { lastId: 100 }]);
    assert.equal(stored.current, null);
    assert.deepEqual(stored.seenIds, [1, 2]);
    assert.equal(stored.lastId, 100);
    assert.equal(stored.exhausted, false);
    assert.deepEqual(stored.events.map((event) => event.type), [
      "empty",
      "fetch",
      "fetch",
      "caught-up"
    ]);
  });

  it("openCurrent rejects unsafe URLs from a custom store before opening", async () => {
    for (const unsafeUrl of UNSAFE_DTF_URLS) {
      let storedState = stateWith({
        current: item(1, { url: unsafeUrl }),
        backlog: [item(2)],
        lastId: 100
      });
      const openedUrls = [];
      const store = {
        async getState() {
          return structuredClone(storedState);
        },
        async setState(nextState) {
          storedState = structuredClone(nextState);
          return nextState;
        }
      };
      const service = createQueueService({
        store,
        openUrl: async (url) => {
          openedUrls.push(url);
        },
        now: () => NOW
      });

      const result = await service.openCurrent();

      assert.equal(result.status, "error");
      assert.match(result.error, /DTF URL/i);
      assert.equal(result.canGoBack, false);
      assert.deepEqual(openedUrls, []);
      assert.equal(storedState.current.url, unsafeUrl);
      assert.deepEqual(storedState.backlog.map((newsItem) => newsItem.id), [2]);
      assert.deepEqual(storedState.seenIds, []);
      assert.equal(storedState.lastId, 100);
      assert.deepEqual(storedState.events.map((event) => event.type), ["error"]);

      const previousResult = await service.previous();

      assert.equal(previousResult.canGoBack, false);
      assert.deepEqual(previousResult.state, storedState);
    }
  });

  it("openCurrent calls the opener with the current URL and advances", async () => {
    const openedUrls = [];
    const { service, store } = await createHarness({
      initialState: stateWith({
        current: item(1),
        backlog: [item(2)]
      }),
      openUrl: async (url) => {
        openedUrls.push(url);
      }
    });

    const result = await service.openCurrent();
    const stored = await store.getState();

    assert.equal(result.status, "ready");
    assert.deepEqual(openedUrls, ["https://dtf.ru/news/1"]);
    assert.equal(stored.current.id, 2);
    assert.deepEqual(stored.seenIds, [1]);
    assert.deepEqual(stored.events.map((event) => event.type), [
      "opened",
      "shown"
    ]);
  });

  it("openCurrent records a successful open before returning a pagination error", async () => {
    const openedUrls = [];
    const { service, store } = await createHarness({
      initialState: stateWith({
        current: item(1),
        lastId: 100
      }),
      batches: [new Error("network down")],
      openUrl: async (url) => {
        openedUrls.push(url);
      }
    });

    const result = await service.openCurrent();
    const stored = await store.getState();

    assert.equal(result.status, "error");
    assert.equal(result.error, "network down");
    assert.deepEqual(openedUrls, ["https://dtf.ru/news/1"]);
    assert.equal(stored.current, null);
    assert.deepEqual(stored.backlog, []);
    assert.deepEqual(stored.seenIds, [1]);
    assert.equal(stored.lastId, 100);
    assert.equal(stored.exhausted, false);
    assert.deepEqual(stored.events.map((event) => event.type), [
      "opened",
      "error"
    ]);
  });

  it("openCurrent persists the opened transition while pagination is pending", async () => {
    const fetchStarted = createDeferred();
    const pendingBatch = createDeferred();
    const { service, store } = await createHarness({
      initialState: stateWith({
        current: item(1),
        lastId: 100
      }),
      batches: [() => {
        fetchStarted.resolve();
        return pendingBatch.promise;
      }],
      openUrl: async () => {}
    });

    const openPromise = service.openCurrent();
    await fetchStarted.promise;
    const pendingState = await store.getState();

    assert.equal(pendingState.current, null);
    assert.deepEqual(pendingState.backlog, []);
    assert.deepEqual(pendingState.seenIds, [1]);
    assert.equal(pendingState.lastId, 100);
    assert.equal(pendingState.exhausted, false);
    assert.deepEqual(pendingState.events.map((event) => event.type), ["opened"]);

    pendingBatch.reject(new Error("network down"));
    const result = await openPromise;
    const failedState = await store.getState();

    assert.equal(result.status, "error");
    assert.equal(failedState.current, null);
    assert.deepEqual(failedState.seenIds, [1]);
    assert.equal(failedState.lastId, 100);
    assert.deepEqual(failedState.events.map((event) => event.type), [
      "opened",
      "error"
    ]);
  });

  it("initialize preserves a retryable post-open state without fetching", async () => {
    const { api, service, store } = await createHarness({
      initialState: stateWith({
        current: item(1),
        lastId: 100
      }),
      batches: [
        new Error("network down"),
        { items: [item(1), item(2)], lastId: 200 }
      ],
      openUrl: async () => {}
    });

    const openResult = await service.openCurrent();
    const stateAfterOpen = await store.getState();
    const initializeResult = await service.initialize();
    const stored = await store.getState();

    assert.equal(openResult.status, "error");
    assert.equal(initializeResult.status, "idle");
    assert.deepEqual(api.calls, [{}]);
    assert.equal(stored.current, null);
    assert.deepEqual(stored.backlog, []);
    assert.deepEqual(stored.seenIds, [1]);
    assert.equal(stored.lastId, 100);
    assert.equal(stored.exhausted, false);
    assert.deepEqual(stored.events.map((event) => event.type), [
      "opened",
      "error"
    ]);
    assert.deepEqual(initializeResult.state, stateAfterOpen);
    assert.deepEqual(stored, stateAfterOpen);

    const retryResult = await service.retry();
    const retriedState = await store.getState();

    assert.equal(retryResult.status, "ready");
    assert.deepEqual(api.calls, [{}, {}]);
    assert.equal(retriedState.current.id, 2);
    assert.deepEqual(retriedState.seenIds, [1]);
    assert.equal(retriedState.lastId, 100);
  });

  it("serializes simultaneous mutations from services sharing one store", async () => {
    const storageArea = createMemoryStorageArea();
    const store = createQueueStore(storageArea, { now: () => NOW });
    await store.setState(
      stateWith({
        current: item(1),
        backlog: [item(2), item(3)],
        lastId: 300
      })
    );
    const serviceA = createQueueService({ store, now: () => NOW });
    const serviceB = createQueueService({ store, now: () => NOW });

    await Promise.all([serviceA.markViewed(), serviceB.markViewed()]);
    const stored = await store.getState();

    assert.equal(stored.current.id, 3);
    assert.deepEqual(stored.backlog, []);
    assert.deepEqual(stored.seenIds, [1, 2]);
    assert.deepEqual(stored.events.map((event) => event.type), [
      "dismissed",
      "shown",
      "dismissed",
      "shown"
    ]);
  });

  it("releases mutation serialization after a rejected action", async () => {
    const storageArea = createMemoryStorageArea();
    const store = createQueueStore(storageArea, { now: () => NOW });
    await store.setState(
      stateWith({
        current: item(1),
        backlog: [item(2)],
        lastId: 200
      })
    );
    const firstStarted = createDeferred();
    const releaseFirst = createDeferred();
    const failingStore = {
      async getState() {
        firstStarted.resolve();
        await releaseFirst.promise;
        throw new Error("storage unavailable");
      },
      setState: (state) => store.setState(state)
    };
    let laterStarted = false;
    const laterStore = {
      getState() {
        laterStarted = true;
        return store.getState();
      },
      setState: (state) => store.setState(state)
    };
    const failingService = createQueueService({
      store: failingStore,
      now: () => NOW
    });
    const laterService = createQueueService({
      store: laterStore,
      now: () => NOW
    });

    const failedMutation = failingService.markViewed();
    await firstStarted.promise;
    const rejected = assert.rejects(failedMutation, /storage unavailable/);
    const laterMutation = laterService.markViewed();
    let laterResult;

    try {
      assert.equal(laterStarted, false);
    } finally {
      releaseFirst.resolve();
      await rejected;
      laterResult = await laterMutation;
    }

    const stored = await store.getState();
    assert.equal(laterResult.status, "ready");
    assert.equal(stored.current.id, 2);
    assert.deepEqual(stored.seenIds, [1]);
  });

  it("reset clears stored state and reinitializes from the first API batch", async () => {
    const { api, service, store } = await createHarness({
      initialState: stateWith({
        current: item(1),
        backlog: [item(2)],
        seenIds: [1],
        lastId: 100,
        exhausted: true
      }),
      batches: [{ items: [item(10), item(11)], lastId: 1100 }]
    });

    const result = await service.reset();
    const stored = await store.getState();

    assert.equal(result.status, "ready");
    assert.deepEqual(api.calls, [{}]);
    assert.equal(stored.current.id, 10);
    assert.deepEqual(stored.backlog.map((newsItem) => newsItem.id), [11]);
    assert.deepEqual(stored.seenIds, []);
    assert.equal(stored.lastId, 1100);
    assert.equal(stored.exhausted, false);
    assert.equal(stored.events[0].type, "reset");
  });

  it("reset clears in-memory history so previous() cannot resurrect a pre-reset item", async () => {
    const { service, store } = await createHarness({
      initialState: stateWith({
        current: item(1),
        backlog: [item(2), item(3)],
        lastId: 300
      }),
      batches: [{ items: [item(10), item(11)], lastId: 1100 }]
    });

    await service.markViewed();
    await service.markViewed();
    const beforeReset = await store.getState();
    assert.equal(beforeReset.current.id, 3);

    const afterReset = await service.reset();

    assert.equal(afterReset.status, "ready");
    assert.equal(afterReset.canGoBack, false);
    assert.equal(afterReset.state.current.id, 10);

    const result = await service.previous();
    const stored = await store.getState();

    assert.equal(result.canGoBack, false);
    assert.deepEqual(result.state, stored);
    assert.equal(stored.current.id, 10);
    assert.deepEqual(stored.backlog.map((newsItem) => newsItem.id), [11]);
  });

  it("reset errors keep prior queue data stable and return an error signal", async () => {
    const { service, store } = await createHarness({
      initialState: stateWith({
        current: item(1),
        backlog: [item(2)],
        seenIds: [9],
        lastId: 100
      }),
      batches: [new Error("network down")]
    });

    const result = await service.reset();
    const stored = await store.getState();

    assert.equal(result.status, "error");
    assert.equal(result.error, "network down");
    assert.equal(stored.current.id, 1);
    assert.deepEqual(stored.backlog.map((newsItem) => newsItem.id), [2]);
    assert.deepEqual(stored.seenIds, [9]);
    assert.equal(stored.lastId, 100);
    assert.equal(stored.exhausted, false);
    assert.deepEqual(stored.events.map((event) => event.type), ["error"]);
  });

  it("API errors preserve the dismissal and return an error signal", async () => {
    const originalState = stateWith({
      current: item(1),
      seenIds: [9],
      lastId: 100
    });
    const { service, store } = await createHarness({
      initialState: originalState,
      batches: [new Error("network down")]
    });

    const result = await service.markViewed();
    const stored = await store.getState();

    assert.equal(result.status, "error");
    assert.equal(result.error, "network down");
    assert.equal(stored.current, null);
    assert.deepEqual(stored.backlog, []);
    assert.deepEqual(stored.seenIds, [9, 1]);
    assert.equal(stored.lastId, 100);
    assert.equal(stored.exhausted, false);
    assert.deepEqual(stored.events.map((event) => event.type), [
      "dismissed",
      "error"
    ]);
  });

  it("open errors keep prior queue data stable and return an error signal", async () => {
    const { service, store } = await createHarness({
      initialState: stateWith({
        current: item(1),
        backlog: [item(2)],
        lastId: 100
      }),
      openUrl: async () => {
        throw new Error("tab blocked");
      }
    });

    const result = await service.openCurrent();
    const stored = await store.getState();

    assert.equal(result.status, "error");
    assert.equal(result.error, "tab blocked");
    assert.equal(result.canGoBack, false);
    assert.equal(stored.current.id, 1);
    assert.deepEqual(stored.backlog.map((newsItem) => newsItem.id), [2]);
    assert.deepEqual(stored.seenIds, []);
    assert.equal(stored.lastId, 100);
    assert.equal(stored.events.at(-1).type, "error");

    const previousResult = await service.previous();
    const afterPrevious = await store.getState();

    assert.equal(previousResult.canGoBack, false);
    assert.deepEqual(afterPrevious, stored);
  });

  it("caps seenIds to the newest ids when advancing past the bound", async () => {
    const seenIds = Array.from({ length: MAX_SEEN_IDS }, (_, index) => index + 1);
    const { service, store } = await createHarness({
      initialState: stateWith({
        current: item(1000),
        backlog: [item(1001)],
        seenIds,
        lastId: 100
      })
    });

    const result = await service.markViewed();
    const stored = await store.getState();

    assert.equal(result.status, "ready");
    assert.equal(stored.current.id, 1001);
    assert.equal(stored.seenIds.length, MAX_SEEN_IDS);
    assert.equal(stored.seenIds.includes(1000), true);
    assert.equal(stored.seenIds.includes(1), false);
  });

  it("loadArchive fetches one older batch from the fork and advances lastId", async () => {
    const { api, service, store } = await createHarness({
      initialState: stateWith({
        current: null,
        seenIds: [1, 2, 3],
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
});

describe("previous", () => {
  it("reports canGoBack: false right after initialize, before any advance", async () => {
    const { service } = await createHarness({
      batches: [{ items: [item(1), item(2)], lastId: 200 }]
    });

    const result = await service.initialize();

    assert.equal(result.canGoBack, false);
  });

  it("is a no-op returning the unchanged state when there is no history", async () => {
    const { service, store } = await createHarness({
      initialState: stateWith({
        current: item(1),
        backlog: [item(2)],
        lastId: 200
      })
    });

    const before = await store.getState();
    const result = await service.previous();
    const stored = await store.getState();

    assert.equal(result.canGoBack, false);
    assert.deepEqual(stored, before);
    assert.deepEqual(result.state, before);
  });

  it("undoes markViewed: restores the item as current, un-marks it seen, requeues the next item", async () => {
    const { service, store } = await createHarness({
      initialState: stateWith({
        current: item(1),
        backlog: [item(2), item(3)],
        lastId: 300
      })
    });

    const afterViewed = await service.markViewed();
    assert.equal(afterViewed.canGoBack, true);

    const result = await service.previous();
    const stored = await store.getState();

    assert.equal(result.status, "ready");
    assert.equal(stored.current.id, 1);
    assert.deepEqual(stored.seenIds, []);
    assert.deepEqual(stored.backlog.map((newsItem) => newsItem.id), [2, 3]);
  });

  it("undoes openCurrent: restores the item as current, un-marks it seen, requeues the next item", async () => {
    const openedUrls = [];
    const { service, store } = await createHarness({
      initialState: stateWith({
        current: item(1),
        backlog: [item(2), item(3)],
        lastId: 300
      }),
      openUrl: async (url) => {
        openedUrls.push(url);
      }
    });

    const afterOpen = await service.openCurrent();
    assert.equal(afterOpen.canGoBack, true);
    assert.deepEqual(openedUrls, ["https://dtf.ru/news/1"]);

    const result = await service.previous();
    const stored = await store.getState();

    assert.equal(result.status, "ready");
    assert.equal(stored.current.id, 1);
    assert.deepEqual(stored.seenIds, []);
    assert.deepEqual(stored.backlog.map((newsItem) => newsItem.id), [2, 3]);
  });

  it("redo via backlog: advancing again after undo shows the same item that was current before undo", async () => {
    const { service, store } = await createHarness({
      initialState: stateWith({
        current: item(1),
        backlog: [item(2), item(3)],
        lastId: 300
      })
    });

    await service.markViewed();
    const beforeUndo = await store.getState();
    assert.equal(beforeUndo.current.id, 2);

    await service.previous();
    const result = await service.markViewed();

    assert.equal(result.state.current.id, 2);
  });

  it("walks back more than one step across multiple previous() calls", async () => {
    const { service, store } = await createHarness({
      initialState: stateWith({
        current: item(1),
        backlog: [item(2), item(3)],
        lastId: 300
      })
    });

    await service.markViewed();
    await service.markViewed();
    const afterTwoAdvances = await store.getState();
    assert.equal(afterTwoAdvances.current.id, 3);

    const firstUndo = await service.previous();
    assert.equal(firstUndo.state.current.id, 2);
    assert.equal(firstUndo.canGoBack, true);

    const secondUndo = await service.previous();
    const stored = await store.getState();

    assert.equal(secondUndo.state.current.id, 1);
    assert.equal(secondUndo.canGoBack, false);
    assert.deepEqual(stored.seenIds, []);
    assert.deepEqual(stored.backlog.map((newsItem) => newsItem.id), [2, 3]);
  });

  it("restores from the exhausted (current: null) state with an empty-but-correct backlog", async () => {
    const { service, store } = await createHarness({
      initialState: stateWith({
        current: item(1),
        lastId: 100
      }),
      batches: [
        { items: [item(1)], lastId: 900 },
        { items: [], lastId: null }
      ]
    });

    const advanced = await service.markViewed();
    assert.equal(advanced.state.current, null);
    assert.equal(advanced.state.exhausted, false);
    assert.equal(advanced.canGoBack, true);

    const result = await service.previous();
    const stored = await store.getState();

    assert.equal(result.status, "ready");
    assert.equal(stored.current.id, 1);
    assert.deepEqual(stored.backlog, []);
    assert.deepEqual(stored.seenIds, []);
    assert.equal(stored.exhausted, false);
  });
});
