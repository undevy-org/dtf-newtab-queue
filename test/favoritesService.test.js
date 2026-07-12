import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_FAVORITES, createFavoritesStore, createInitialFavoritesState, isFavoritesState } from "../src/favoritesStore.js";
import { createMemoryStorageArea } from "../src/queueStore.js";
import {
  createFavoritesService,
  normalizeFavoriteUrl,
  normalizeNullableImageUrl
} from "../src/favoritesService.js";

const NOW = "2026-07-07T10:00:00.000Z";

async function createHarness() {
  let id = 0;
  const store = createFavoritesStore(createMemoryStorageArea(), { now: () => NOW });
  const service = createFavoritesService({
    store,
    now: () => NOW,
    createId: () => `fav-${++id}`,
    defaultBackgroundColor: () => "#24292f"
  });

  return { service, store };
}

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

describe("favoritesService", () => {
  describe("normalizeFavoriteUrl", () => {
    it("normalizes URLs without an explicit protocol", () => {
      assert.deepEqual(normalizeFavoriteUrl("example.com/path"), {
        url: "https://example.com/path",
        domain: "example.com"
      });
    });

    it("normalizes localhost URLs while preserving http", () => {
      assert.deepEqual(normalizeFavoriteUrl(" http://localhost:3000/a "), {
        url: "http://localhost:3000/a",
        domain: "localhost"
      });
    });

    it("normalizes host-with-port URLs without an explicit protocol", () => {
      assert.deepEqual(normalizeFavoriteUrl("example.com:8443/path"), {
        url: "https://example.com:8443/path",
        domain: "example.com"
      });
    });

    it("normalizes bare host:port URLs without a dot in the host", () => {
      assert.deepEqual(normalizeFavoriteUrl("router:8080"), {
        url: "https://router:8080/",
        domain: "router"
      });
      assert.deepEqual(normalizeFavoriteUrl("nas:9000/share"), {
        url: "https://nas:9000/share",
        domain: "nas"
      });
    });

    it("rejects empty URLs", () => {
      assert.throws(() => normalizeFavoriteUrl(""), /Enter a URL/);
    });

    it("rejects unsupported URL protocols", () => {
      assert.throws(
        () => normalizeFavoriteUrl("javascript:alert(1)"),
        /Only http and https URLs are supported/
      );
      assert.throws(
        () => normalizeFavoriteUrl("file:///tmp/icon.png"),
        /Only http and https URLs are supported/
      );
    });
  });

  describe("normalizeNullableImageUrl", () => {
    it("normalizes empty image URLs to null", () => {
      assert.equal(normalizeNullableImageUrl(""), null);
      assert.equal(normalizeNullableImageUrl("   "), null);
      assert.equal(normalizeNullableImageUrl(null), null);
    });

    it("normalizes image URLs without an explicit protocol", () => {
      assert.equal(
        normalizeNullableImageUrl("cdn.example.com/icon.png"),
        "https://cdn.example.com/icon.png"
      );
    });

    it("normalizes host-with-port image URLs without an explicit protocol", () => {
      assert.equal(
        normalizeNullableImageUrl("cdn.example.com:8443/icon.png"),
        "https://cdn.example.com:8443/icon.png"
      );
    });

    it("normalizes bare host:port image URLs without a dot in the host", () => {
      assert.equal(
        normalizeNullableImageUrl("router:9000/icon.png"),
        "https://router:9000/icon.png"
      );
    });

    it("preserves explicit https image URLs", () => {
      assert.equal(
        normalizeNullableImageUrl("https://cdn.example.com/icon.png"),
        "https://cdn.example.com/icon.png"
      );
    });

    it("rejects unsupported image URL protocols", () => {
      assert.throws(
        () => normalizeNullableImageUrl("data:image/png;base64,abc"),
        /Only http and https image URLs are supported/
      );
    });
  });

  it("adds a favorite with normalized defaults and persists it", async () => {
    const { service, store } = await createHarness();

    const state = await service.addFavorite({ url: "example.com/path" });

    assert.deepEqual(state.items, [
      {
        id: "fav-1",
        url: "https://example.com/path",
        label: "example.com",
        domain: "example.com",
        iconMode: "favicon",
        customIconUrl: null,
        backgroundColor: "#24292f",
        backgroundColorSource: "auto",
        createdAt: NOW,
        updatedAt: NOW
      }
    ]);
    assert.deepEqual(await store.getState(), state);
  });

  it("derives manual background color source when adding a custom color", async () => {
    const { service } = await createHarness();

    const state = await service.addFavorite({
      url: "example.com",
      backgroundColor: "#112233"
    });

    assert.equal(state.items[0].backgroundColor, "#112233");
    assert.equal(state.items[0].backgroundColorSource, "manual");
  });

  it("updates favorite fields", async () => {
    const { service, store } = await createHarness();
    await service.addFavorite({ url: "example.com" });

    const state = await service.updateFavorite("fav-1", {
      url: "news.ycombinator.com/item",
      label: "HN item",
      iconMode: "custom",
      customIconUrl: "cdn.example.com/icon.png",
      backgroundColor: "#ABCDEF",
      backgroundColorSource: "manual"
    });

    assert.deepEqual(state.items[0], {
      id: "fav-1",
      url: "https://news.ycombinator.com/item",
      label: "HN item",
      domain: "news.ycombinator.com",
      iconMode: "custom",
      customIconUrl: "https://cdn.example.com/icon.png",
      backgroundColor: "#abcdef",
      backgroundColorSource: "manual",
      createdAt: NOW,
      updatedAt: NOW
    });
    assert.deepEqual(await store.getState(), state);
  });

  it("derives manual background color source when updating only color", async () => {
    const { service } = await createHarness();
    await service.addFavorite({ url: "example.com" });

    const state = await service.updateFavorite("fav-1", {
      backgroundColor: "#445566"
    });

    assert.equal(state.items[0].backgroundColor, "#445566");
    assert.equal(state.items[0].backgroundColorSource, "manual");
  });

  it("preserves a manual background color when color fields are omitted", async () => {
    const { service } = await createHarness();
    await service.addFavorite({
      url: "example.com",
      backgroundColor: "#ffcc00",
      backgroundColorSource: "manual"
    });

    const state = await service.updateFavorite("fav-1", { label: "Example" });

    assert.equal(state.items[0].backgroundColor, "#ffcc00");
    assert.equal(state.items[0].backgroundColorSource, "manual");
  });

  it("deletes favorites", async () => {
    const { service, store } = await createHarness();
    await service.addFavorite({ url: "one.example.com" });
    await service.addFavorite({ url: "two.example.com" });

    const state = await service.deleteFavorite("fav-1");

    assert.deepEqual(
      state.items.map((item) => item.id),
      ["fav-2"]
    );
    assert.deepEqual(await store.getState(), state);
  });

  it("moves favorites by direction and clamps at boundaries", async () => {
    const { service, store } = await createHarness();
    await service.addFavorite({ url: "one.example.com" });
    await service.addFavorite({ url: "two.example.com" });
    await service.addFavorite({ url: "three.example.com" });

    let state = await service.moveFavorite("fav-2", -1);
    assert.deepEqual(
      state.items.map((item) => item.id),
      ["fav-2", "fav-1", "fav-3"]
    );

    state = await service.moveFavorite("fav-2", -1);
    assert.deepEqual(
      state.items.map((item) => item.id),
      ["fav-2", "fav-1", "fav-3"]
    );

    state = await service.moveFavorite("fav-2", 1);
    assert.deepEqual(
      state.items.map((item) => item.id),
      ["fav-1", "fav-2", "fav-3"]
    );

    state = await service.moveFavorite("fav-3", 1);
    assert.deepEqual(
      state.items.map((item) => item.id),
      ["fav-1", "fav-2", "fav-3"]
    );
    assert.deepEqual(await store.getState(), state);
  });

  it("rejects invalid move directions", async () => {
    const { service } = await createHarness();
    await service.addFavorite({ url: "one.example.com" });
    await service.addFavorite({ url: "two.example.com" });

    await assert.rejects(
      () => service.moveFavorite("fav-1"),
      /Move direction must be a finite number/
    );
    await assert.rejects(
      () => service.moveFavorite("fav-1", "left"),
      /Move direction must be a finite number/
    );
  });

  it("rejects updates, deletes, and moves for unknown favorites", async () => {
    const { service } = await createHarness();

    await assert.rejects(
      () => service.updateFavorite("missing", { label: "Missing" }),
      /Favorite not found/
    );
    await assert.rejects(() => service.deleteFavorite("missing"), /Favorite not found/);
    await assert.rejects(() => service.moveFavorite("missing", 1), /Favorite not found/);
  });

  it("rejects invalid favorite background colors", async () => {
    const { service } = await createHarness();

    await assert.rejects(
      () => service.addFavorite({ url: "example.com", backgroundColor: "red" }),
      /Use a hex color/
    );
  });

  it("rejects adding a favorite once the limit is reached", async () => {
    const { service, store } = await createHarness();
    const items = Array.from({ length: MAX_FAVORITES }, (_, index) =>
      favorite({
        id: `fav-seed-${index}`,
        url: `https://example-${index}.com/`,
        domain: `example-${index}.com`
      })
    );
    await store.setState({
      version: 1,
      items,
      createdAt: NOW,
      updatedAt: NOW
    });

    await assert.rejects(
      () => service.addFavorite({ url: "https://new.example.com" }),
      new RegExp(`up to ${MAX_FAVORITES} favorites`)
    );
    assert.equal((await store.getState()).items.length, MAX_FAVORITES);
  });

  it("serializes simultaneous mutations from services sharing one store", async () => {
    const store = createFavoritesStore(createMemoryStorageArea(), { now: () => NOW });
    await store.setState({
      version: 1,
      items: [
        favorite({ id: "fav-a", url: "https://a.example.com/", domain: "a.example.com" }),
        favorite({ id: "fav-b", url: "https://b.example.com/", domain: "b.example.com" }),
        favorite({ id: "fav-c", url: "https://c.example.com/", domain: "c.example.com" })
      ],
      createdAt: NOW,
      updatedAt: NOW
    });

    const serviceA = createFavoritesService({
      store,
      now: () => NOW,
      defaultBackgroundColor: () => "#24292f"
    });
    const serviceB = createFavoritesService({
      store,
      now: () => NOW,
      defaultBackgroundColor: () => "#24292f"
    });

    await Promise.all([
      serviceA.deleteFavorite("fav-a"),
      serviceB.moveFavorite("fav-c", -1)
    ]);

    const stored = await store.getState();
    assert.deepEqual(
      stored.items.map((item) => item.id),
      ["fav-c", "fav-b"]
    );
  });

  it("keeps the favorites lock available after a rejected mutation", async () => {
    const { service } = await createHarness();
    await service.addFavorite({ url: "example.com" });

    await assert.rejects(
      () => service.moveFavorite("missing", 1),
      /Favorite not found/
    );

    const state = await service.moveFavorite("fav-1", 1);
    assert.deepEqual(
      state.items.map((item) => item.id),
      ["fav-1"]
    );
  });
});

describe("stored backgroundColorSource enum survives the label rename", () => {
  it("accepts items whose backgroundColorSource is auto or manual", () => {
    const base = createInitialFavoritesState("2026-07-11T00:00:00.000Z");
    for (const source of ["auto", "manual"]) {
      const state = {
        ...base,
        items: [
          {
            id: "fav-1",
            url: "https://dtf.ru/",
            label: "DTF",
            domain: "dtf.ru",
            iconMode: "favicon",
            customIconUrl: null,
            backgroundColor: "#24292f",
            backgroundColorSource: source,
            createdAt: base.createdAt,
            updatedAt: base.updatedAt
          }
        ]
      };
      assert.equal(isFavoritesState(state), true, `source=${source}`);
    }
  });

  it("rejects a renamed/localized backgroundColorSource value", () => {
    const base = createInitialFavoritesState("2026-07-11T00:00:00.000Z");
    const state = {
      ...base,
      items: [
        {
          id: "fav-1",
          url: "https://dtf.ru/",
          label: "DTF",
          domain: "dtf.ru",
          iconMode: "favicon",
          customIconUrl: null,
          backgroundColor: "#24292f",
          backgroundColorSource: "Определять по favicon",
          createdAt: base.createdAt,
          updatedAt: base.updatedAt
        }
      ]
    };
    assert.equal(isFavoritesState(state), false);
  });
});
