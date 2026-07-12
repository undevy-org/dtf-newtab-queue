import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMemoryStorageArea } from "../src/queueStore.js";
import {
  FAVORITES_STORAGE_KEY,
  MAX_FAVORITES,
  createFavoritesStore,
  createInitialFavoritesState,
  isFavoritesState
} from "../src/favoritesStore.js";

const NOW = "2026-07-07T10:00:00.000Z";

function favorite(overrides = {}) {
  return {
    id: "fav-1",
    url: "https://example.com/",
    label: "Example",
    domain: "example.com",
    iconMode: "favicon",
    customIconUrl: null,
    backgroundColor: "#24292f",
    backgroundColorSource: "auto",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

describe("favoritesStore", () => {
  it("creates an empty initial favorites state", () => {
    assert.deepEqual(createInitialFavoritesState(NOW), {
      version: 1,
      items: [],
      createdAt: NOW,
      updatedAt: NOW
    });
  });

  it("accepts a valid favorites state", () => {
    assert.equal(
      isFavoritesState({
        version: 1,
        items: [favorite()],
        createdAt: NOW,
        updatedAt: NOW
      }),
      true
    );
  });

  it("rejects invalid favorites state shapes", () => {
    const valid = {
      version: 1,
      items: [favorite()],
      createdAt: NOW,
      updatedAt: NOW
    };

    assert.equal(isFavoritesState(null), false);
    assert.equal(isFavoritesState([]), false);
    assert.equal(isFavoritesState({ ...valid, version: 2 }), false);
    assert.equal(isFavoritesState({ ...valid, items: "bad" }), false);
    assert.equal(isFavoritesState({ ...valid, createdAt: "bad-date" }), false);
    assert.equal(isFavoritesState({ ...valid, updatedAt: "" }), false);
    assert.equal(isFavoritesState({ ...valid, items: [favorite({ id: "" })] }), false);
    assert.equal(isFavoritesState({ ...valid, items: [favorite({ url: "javascript:alert(1)" })] }), false);
    assert.equal(isFavoritesState({ ...valid, items: [favorite({ iconMode: "unknown" })] }), false);
    assert.equal(isFavoritesState({ ...valid, items: [favorite({ customIconUrl: "file:///tmp/a.png" })] }), false);
    assert.equal(isFavoritesState({ ...valid, items: [favorite({ backgroundColor: "red" })] }), false);
    assert.equal(isFavoritesState({ ...valid, items: [favorite({ backgroundColorSource: "remote" })] }), false);
  });

  it("validates an explicit tileSize when present, but tolerates its absence", () => {
    const base = {
      version: 1,
      items: [favorite()],
      createdAt: NOW,
      updatedAt: NOW
    };

    assert.equal(isFavoritesState(base), true, "absent tileSize (legacy item)");
    assert.equal(
      isFavoritesState({ ...base, items: [favorite({ tileSize: "square" })] }),
      true,
      "square"
    );
    assert.equal(
      isFavoritesState({ ...base, items: [favorite({ tileSize: "wide" })] }),
      true,
      "wide"
    );
    assert.equal(
      isFavoritesState({ ...base, items: [favorite({ tileSize: "huge" })] }),
      false,
      "unknown tileSize"
    );
  });

  it("rejects states above the item cap", () => {
    const state = {
      version: 1,
      items: Array.from({ length: MAX_FAVORITES + 1 }, (_, index) =>
        favorite({
          id: `fav-${index}`,
          url: `https://example-${index}.com/`,
          domain: `example-${index}.com`
        })
      ),
      createdAt: NOW,
      updatedAt: NOW
    };

    assert.equal(isFavoritesState(state), false);
  });

  it("rejects invalid favorites state on set", async () => {
    const storageArea = createMemoryStorageArea();
    const store = createFavoritesStore(storageArea, { now: () => NOW });
    const invalidState = {
      version: 1,
      items: "bad",
      createdAt: NOW,
      updatedAt: NOW
    };

    await assert.rejects(() => store.setState(invalidState), {
      message: "Invalid favorites state"
    });
  });

  it("persists, reads, clears, and clones favorites state", async () => {
    const storageArea = createMemoryStorageArea();
    const store = createFavoritesStore(storageArea, { now: () => NOW });
    const state = {
      version: 1,
      items: [favorite()],
      createdAt: NOW,
      updatedAt: NOW
    };

    await store.setState(state);
    state.items[0].label = "Mutated after set";

    const loaded = await store.getState();
    assert.equal(loaded.items[0].label, "Example");
    assert.deepEqual(await storageArea.get(FAVORITES_STORAGE_KEY), {
      [FAVORITES_STORAGE_KEY]: loaded
    });

    loaded.items[0].label = "Mutated after get";
    assert.equal((await store.getState()).items[0].label, "Example");

    await store.clearState();
    assert.deepEqual(await store.getState(), createInitialFavoritesState(NOW));
  });

  it("returns initial state when stored favorites are absent or corrupt", async () => {
    const storageArea = createMemoryStorageArea();
    const store = createFavoritesStore(storageArea, { now: () => NOW });

    assert.deepEqual(await store.getState(), createInitialFavoritesState(NOW));

    await storageArea.set({ [FAVORITES_STORAGE_KEY]: { version: 1, items: "bad" } });
    assert.deepEqual(await store.getState(), createInitialFavoritesState(NOW));
  });
});
