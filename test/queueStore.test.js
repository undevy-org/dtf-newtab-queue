import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_EVENTS,
  STORAGE_KEY,
  appendEvent,
  createInitialState,
  createMemoryStorageArea,
  createQueueStore,
  isQueueState
} from "../src/queueStore.js";

const UNSAFE_DTF_URLS = [
  "javascript:alert(1)",
  "http://dtf.ru/news/1",
  "https://dtf.ru.evil.example/news/1",
  "https://.dtf.ru/news/1",
  "https://user:pass@dtf.ru/news/1",
  "https://dtf.ru:444/news/1",
  "not a URL"
];

function createQueueItem(overrides = {}) {
  return {
    id: 1,
    title: "First",
    url: "https://dtf.ru/news/1-first",
    date: 1781691557,
    sourceBatchLastId: null,
    ...overrides
  };
}

function createStoreEvent(overrides = {}) {
  return {
    type: "init",
    at: "2026-06-17T10:00:01.000Z",
    details: {},
    ...overrides
  };
}

describe("queueStore", () => {
  it("creates an empty initial queue state", () => {
    const state = createInitialState("2026-06-17T10:00:00.000Z");

    assert.deepEqual(state, {
      current: null,
      backlog: [],
      seenIds: [],
      lastId: null,
      initializedAt: "2026-06-17T10:00:00.000Z",
      updatedAt: "2026-06-17T10:00:00.000Z",
      exhausted: false,
      events: []
    });
  });

  it("appends bounded events", () => {
    let state = createInitialState("2026-06-17T10:00:00.000Z");

    for (let index = 0; index < 505; index += 1) {
      state = appendEvent(
        state,
        "fetch",
        { index },
        () => `2026-06-17T10:00:${String(index).padStart(2, "0")}.000Z`
      );
    }

    assert.equal(state.events.length, 500);
    assert.equal(state.events[0].details.index, 5);
    assert.equal(state.events.at(-1).details.index, 504);
    assert.equal(state.updatedAt, "2026-06-17T10:00:504.000Z");
  });

  it("persists, reads, and clears state", async () => {
    const storageArea = createMemoryStorageArea();
    const store = createQueueStore(storageArea, {
      now: () => "2026-06-17T10:00:02.000Z"
    });
    const state = appendEvent(
      createInitialState("2026-06-17T10:00:00.000Z"),
      "init",
      {},
      () => "2026-06-17T10:00:01.000Z"
    );

    await store.setState(state);
    assert.deepEqual(await store.getState(), state);
    assert.deepEqual(await storageArea.get(STORAGE_KEY), {
      [STORAGE_KEY]: state
    });

    await store.clearState();
    assert.deepEqual(
      await store.getState(),
      createInitialState("2026-06-17T10:00:02.000Z")
    );
  });

  it("returns initial state when stored state is absent or corrupt", async () => {
    const storageArea = createMemoryStorageArea();
    const store = createQueueStore(storageArea, {
      now: () => "2026-06-17T10:00:03.000Z"
    });

    assert.deepEqual(
      await store.getState(),
      createInitialState("2026-06-17T10:00:03.000Z")
    );

    await storageArea.set({ [STORAGE_KEY]: { current: "corrupt" } });

    assert.deepEqual(
      await store.getState(),
      createInitialState("2026-06-17T10:00:03.000Z")
    );
  });

  it("rejects invalid queue state shapes", () => {
    const state = createInitialState("2026-06-17T10:00:00.000Z");
    const missingInitializedAt = { ...state };
    delete missingInitializedAt.initializedAt;
    const missingUpdatedAt = { ...state };
    delete missingUpdatedAt.updatedAt;

    const inheritedRequiredFields = Object.assign(
      Object.create({
        current: null,
        lastId: null,
        initializedAt: "2026-06-17T10:00:00.000Z",
        updatedAt: "2026-06-17T10:00:00.000Z"
      }),
      {
        backlog: [],
        seenIds: [],
        exhausted: false,
        events: []
      }
    );

    assert.equal(isQueueState(state), true);
    assert.equal(isQueueState(missingInitializedAt), false);
    assert.equal(isQueueState(missingUpdatedAt), false);
    assert.equal(isQueueState({ ...state, initializedAt: "" }), false);
    assert.equal(isQueueState({ ...state, initializedAt: "not-a-date" }), false);
    assert.equal(isQueueState({ ...state, updatedAt: 123 }), false);
    assert.equal(isQueueState({ ...state, updatedAt: "" }), false);
    assert.equal(isQueueState({ ...state, updatedAt: "not-a-date" }), false);
    assert.equal(isQueueState({ ...state, exhausted: "false" }), false);
    assert.equal(isQueueState(inheritedRequiredFields), false);
    assert.equal(isQueueState({ ...state, lastId: Number.POSITIVE_INFINITY }), false);
  });

  it("rejects malformed loaded queue items and events", () => {
    const state = {
      ...createInitialState("2026-06-17T10:00:00.000Z"),
      current: createQueueItem(),
      backlog: [createQueueItem({ id: 2 })],
      seenIds: [1],
      lastId: 2,
      events: [createStoreEvent()]
    };
    const tooManyEvents = Array.from({ length: MAX_EVENTS + 1 }, (_, index) =>
      createStoreEvent({ details: { index } })
    );

    assert.equal(isQueueState(state), true);
    assert.equal(
      isQueueState({ ...state, current: { ...createQueueItem(), id: "1" } }),
      false
    );
    assert.equal(
      isQueueState({ ...state, backlog: [{ ...createQueueItem(), url: "" }] }),
      false
    );
    assert.equal(isQueueState({ ...state, backlog: [null] }), false);
    assert.equal(isQueueState({ ...state, seenIds: ["1"] }), false);
    assert.equal(
      isQueueState({ ...state, events: [{ ...createStoreEvent(), at: 123 }] }),
      false
    );
    assert.equal(
      isQueueState({ ...state, events: [{ ...createStoreEvent(), at: "" }] }),
      false
    );
    assert.equal(
      isQueueState({ ...state, events: [{ ...createStoreEvent(), at: "not-a-date" }] }),
      false
    );
    assert.equal(
      isQueueState({ ...state, events: [{ ...createStoreEvent(), details: null }] }),
      false
    );
    assert.equal(isQueueState({ ...state, events: tooManyEvents }), false);
  });

  it("accepts only safe DTF URLs in persisted queue items", () => {
    const state = {
      ...createInitialState("2026-06-17T10:00:00.000Z"),
      current: createQueueItem()
    };

    assert.equal(isQueueState(state), true);
    assert.equal(
      isQueueState({
        ...state,
        current: createQueueItem({ url: "https://m.dtf.ru/news/1-first" })
      }),
      true
    );

    for (const unsafeUrl of UNSAFE_DTF_URLS) {
      assert.equal(
        isQueueState({
          ...state,
          current: createQueueItem({ url: unsafeUrl })
        }),
        false
      );
    }
  });

  it("falls back safely when persisted queue state contains an unsafe URL", async () => {
    const poisonedState = {
      ...createInitialState("2026-06-17T10:00:00.000Z"),
      current: createQueueItem({ url: "javascript:alert(1)" })
    };
    const storageArea = createMemoryStorageArea({
      [STORAGE_KEY]: poisonedState
    });
    const store = createQueueStore(storageArea, {
      now: () => "2026-06-17T10:00:03.000Z"
    });

    assert.deepEqual(
      await store.getState(),
      createInitialState("2026-06-17T10:00:03.000Z")
    );
  });

  it("rejects decorated arrays as queue states", () => {
    const decoratedArray = [];

    Object.assign(decoratedArray, {
      current: null,
      backlog: [],
      seenIds: [],
      lastId: null,
      initializedAt: "2026-06-17T10:00:00.000Z",
      exhausted: false,
      events: []
    });

    assert.equal(isQueueState(decoratedArray), false);
  });

  it("omits missing memory storage keys and removes array keys", async () => {
    const storageArea = createMemoryStorageArea({
      keep: "value",
      present: 1,
      removeMe: true
    });

    assert.deepEqual(await storageArea.get("missing"), {});
    assert.deepEqual(await storageArea.get(["present", "missing"]), {
      present: 1
    });

    await storageArea.remove(["removeMe", "missing"]);

    assert.deepEqual(await storageArea.get(["keep", "removeMe"]), {
      keep: "value"
    });
  });

  it("supports memory storage object defaults", async () => {
    const storageArea = createMemoryStorageArea({
      present: {
        nested: "stored"
      }
    });
    const defaults = {
      present: {
        nested: "default"
      },
      missing: {
        nested: "fallback"
      }
    };

    const result = await storageArea.get(defaults);

    assert.deepEqual(result, {
      present: {
        nested: "stored"
      },
      missing: {
        nested: "fallback"
      }
    });

    result.present.nested = "mutated result";
    result.missing.nested = "mutated default";

    assert.deepEqual(await storageArea.get(defaults), {
      present: {
        nested: "stored"
      },
      missing: {
        nested: "fallback"
      }
    });
    assert.equal(defaults.missing.nested, "fallback");
  });

  it("clones memory storage values on set and get", async () => {
    const storageArea = createMemoryStorageArea();
    const store = createQueueStore(storageArea);
    const state = {
      ...createInitialState("2026-06-17T10:00:00.000Z"),
      current: createQueueItem(),
      events: [
        createStoreEvent({
          details: {
            nested: {
              count: 1
            }
          }
        })
      ]
    };

    await store.setState(state);
    state.current.title = "Mutated after set";
    state.events[0].details.nested.count = 2;

    const loaded = await store.getState();
    assert.equal(loaded.current.title, "First");
    assert.equal(loaded.events[0].details.nested.count, 1);

    loaded.current.title = "Mutated after get";
    loaded.events[0].details.nested.count = 3;

    const reloaded = await store.getState();
    assert.equal(reloaded.current.title, "First");
    assert.equal(reloaded.events[0].details.nested.count, 1);
  });
});
