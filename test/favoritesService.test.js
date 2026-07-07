import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFavoritesStore } from "../src/favoritesStore.js";
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

  it("updates favorite fields", async () => {
    const { service } = await createHarness();
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
    const { service } = await createHarness();
    await service.addFavorite({ url: "one.example.com" });
    await service.addFavorite({ url: "two.example.com" });

    const state = await service.deleteFavorite("fav-1");

    assert.deepEqual(
      state.items.map((item) => item.id),
      ["fav-2"]
    );
  });

  it("moves favorites by direction and clamps at boundaries", async () => {
    const { service } = await createHarness();
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
});
