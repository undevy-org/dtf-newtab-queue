import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMemoryStorageArea } from "../src/queueStore.js";
import {
  FAVORITES_META_KEY,
  FAVORITES_STORAGE_KEY,
  MAX_FAVORITES,
  createFavoritesStore,
  createInitialFavoritesState,
  favoriteItemStorageKey,
  isFavoritesState,
  migrateLegacyFavorites
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

  it("persists, reads, clears, and clones favorites state across a meta key and per-item keys", async () => {
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
    assert.deepEqual(await storageArea.get(FAVORITES_META_KEY), {
      [FAVORITES_META_KEY]: {
        version: 1,
        order: ["fav-1"],
        createdAt: NOW,
        updatedAt: NOW
      }
    });
    assert.deepEqual(await storageArea.get(favoriteItemStorageKey("fav-1")), {
      [favoriteItemStorageKey("fav-1")]: loaded.items[0]
    });

    loaded.items[0].label = "Mutated after get";
    assert.equal((await store.getState()).items[0].label, "Example");

    await store.clearState();
    assert.deepEqual(await store.getState(), createInitialFavoritesState(NOW));
    assert.deepEqual(await storageArea.get(null), {});
  });

  it("returns initial state when stored favorites are absent or corrupt", async () => {
    const storageArea = createMemoryStorageArea();
    const store = createFavoritesStore(storageArea, { now: () => NOW });

    assert.deepEqual(await store.getState(), createInitialFavoritesState(NOW));

    await storageArea.set({ [FAVORITES_META_KEY]: { version: 1, order: "bad" } });
    assert.deepEqual(await store.getState(), createInitialFavoritesState(NOW));
  });

  it("preserves item order via meta.order across get/set roundtrips, independent of insertion", async () => {
    const storageArea = createMemoryStorageArea();
    const store = createFavoritesStore(storageArea, { now: () => NOW });
    const state = {
      version: 1,
      items: [
        favorite({ id: "fav-b", url: "https://b.example/", domain: "b.example" }),
        favorite({ id: "fav-a", url: "https://a.example/", domain: "a.example" })
      ],
      createdAt: NOW,
      updatedAt: NOW
    };

    await store.setState(state);
    const loaded = await store.getState();
    assert.deepEqual(loaded.items.map((item) => item.id), ["fav-b", "fav-a"]);
  });

  it("removes the per-item key for a deleted favorite, leaving no orphan", async () => {
    const storageArea = createMemoryStorageArea();
    const store = createFavoritesStore(storageArea, { now: () => NOW });
    const itemA = favorite({ id: "fav-a", url: "https://a.example/", domain: "a.example" });
    const itemB = favorite({ id: "fav-b", url: "https://b.example/", domain: "b.example" });

    await store.setState({ version: 1, items: [itemA, itemB], createdAt: NOW, updatedAt: NOW });
    await store.setState({ version: 1, items: [itemA], createdAt: NOW, updatedAt: NOW });

    assert.deepEqual(await storageArea.get(favoriteItemStorageKey("fav-b")), {});
    const loaded = await store.getState();
    assert.deepEqual(loaded.items.map((item) => item.id), ["fav-a"]);
  });

  it("tolerates a meta entry whose item key hasn't synced yet, rather than discarding everything", async () => {
    const storageArea = createMemoryStorageArea();
    const store = createFavoritesStore(storageArea, { now: () => NOW });
    const itemA = favorite({ id: "fav-a", url: "https://a.example/", domain: "a.example" });

    await storageArea.set({
      [FAVORITES_META_KEY]: {
        version: 1,
        order: ["fav-a", "fav-missing"],
        createdAt: NOW,
        updatedAt: NOW
      },
      [favoriteItemStorageKey("fav-a")]: itemA
    });

    const loaded = await store.getState();
    assert.deepEqual(loaded.items.map((item) => item.id), ["fav-a"]);
  });

  it("clearState removes the meta key and every currently-referenced item key", async () => {
    const storageArea = createMemoryStorageArea();
    const store = createFavoritesStore(storageArea, { now: () => NOW });
    const itemA = favorite({ id: "fav-a", url: "https://a.example/", domain: "a.example" });

    await store.setState({ version: 1, items: [itemA], createdAt: NOW, updatedAt: NOW });
    await store.clearState();

    assert.deepEqual(await storageArea.get(null), {});
  });

  it("surfaces a friendly error when the sync write exceeds quota, without leaving partial state", async () => {
    const storageArea = createMemoryStorageArea({}, { quotaBytesPerItem: 50 });
    const store = createFavoritesStore(storageArea, { now: () => NOW });
    const itemA = favorite({ id: "fav-a", url: "https://a.example/", domain: "a.example" });

    await assert.rejects(
      () => store.setState({ version: 1, items: [itemA], createdAt: NOW, updatedAt: NOW }),
      /Couldn't save this change to Chrome Sync/
    );

    assert.deepEqual(await store.getState(), createInitialFavoritesState(NOW));
  });
});

describe("migrateLegacyFavorites", () => {
  it("no-ops when there is no legacy blob", async () => {
    const localStorageArea = createMemoryStorageArea();
    const syncStorageArea = createMemoryStorageArea();
    const store = createFavoritesStore(syncStorageArea, { now: () => NOW });

    const result = await migrateLegacyFavorites(localStorageArea, store, {
      now: () => NOW
    });

    assert.deepEqual(result, { migrated: false });
    assert.deepEqual(await store.getState(), createInitialFavoritesState(NOW));
  });

  it("migrates a valid legacy blob into the sync store and clears the legacy key", async () => {
    const legacyState = {
      version: 1,
      items: [favorite()],
      createdAt: NOW,
      updatedAt: NOW
    };
    const localStorageArea = createMemoryStorageArea({
      [FAVORITES_STORAGE_KEY]: legacyState
    });
    const syncStorageArea = createMemoryStorageArea();
    const store = createFavoritesStore(syncStorageArea, { now: () => NOW });

    const result = await migrateLegacyFavorites(localStorageArea, store, {
      now: () => NOW
    });

    assert.deepEqual(result, { migrated: true });
    assert.deepEqual(await localStorageArea.get(FAVORITES_STORAGE_KEY), {});
    const migrated = await store.getState();
    assert.deepEqual(migrated.items.map((item) => item.id), ["fav-1"]);
  });

  it("discards a corrupt legacy blob instead of retrying it forever", async () => {
    const localStorageArea = createMemoryStorageArea({
      [FAVORITES_STORAGE_KEY]: { version: 1, items: "bad" }
    });
    const syncStorageArea = createMemoryStorageArea();
    const store = createFavoritesStore(syncStorageArea, { now: () => NOW });

    const result = await migrateLegacyFavorites(localStorageArea, store, {
      now: () => NOW
    });

    assert.deepEqual(result, { migrated: false, discardedCorrupt: true });
    assert.deepEqual(await localStorageArea.get(FAVORITES_STORAGE_KEY), {});
  });

  it("does not clear the legacy key when the sync write throws", async () => {
    const legacyState = {
      version: 1,
      items: [favorite()],
      createdAt: NOW,
      updatedAt: NOW
    };
    const localStorageArea = createMemoryStorageArea({
      [FAVORITES_STORAGE_KEY]: legacyState
    });
    const syncStorageArea = createMemoryStorageArea({}, { quotaBytesPerItem: 1 });
    const store = createFavoritesStore(syncStorageArea, { now: () => NOW });

    await assert.rejects(() =>
      migrateLegacyFavorites(localStorageArea, store, { now: () => NOW })
    );

    assert.deepEqual(await localStorageArea.get(FAVORITES_STORAGE_KEY), {
      [FAVORITES_STORAGE_KEY]: legacyState
    });
  });
});
