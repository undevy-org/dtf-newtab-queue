import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FAVICON_SIZE,
  getFaviconUrl,
  getFavoriteIconModel,
  getFavoriteLetter
} from "../src/favoriteIcon.js";

const BASE = "chrome-extension://abc123/_favicon/";

function favorite(overrides = {}) {
  return {
    id: "fav-1",
    url: "https://dtf.ru/",
    label: "DTF",
    domain: "dtf.ru",
    iconMode: "favicon",
    customIconUrl: null,
    backgroundColor: "#24292f",
    backgroundColorSource: "auto",
    ...overrides
  };
}

describe("getFaviconUrl", () => {
  it("appends pageUrl and size to the injected base URL", () => {
    assert.equal(
      getFaviconUrl({ baseUrl: BASE, pageUrl: "https://dtf.ru/" }),
      `${BASE}?pageUrl=https%3A%2F%2Fdtf.ru%2F&size=${FAVICON_SIZE}`
    );
  });

  it("honors an explicit size", () => {
    assert.equal(
      getFaviconUrl({ baseUrl: BASE, pageUrl: "https://dtf.ru/", size: 16 }),
      `${BASE}?pageUrl=https%3A%2F%2Fdtf.ru%2F&size=16`
    );
  });
});

describe("getFavoriteIconModel", () => {
  it("builds a favicon image URL from the base when in favicon mode", () => {
    const model = getFavoriteIconModel(favorite(), { faviconBaseUrl: BASE });
    assert.equal(model.type, "image");
    assert.equal(
      model.src,
      `${BASE}?pageUrl=https%3A%2F%2Fdtf.ru%2F&size=${FAVICON_SIZE}`
    );
  });

  it("falls back to a letter when no favicon base URL is available", () => {
    const model = getFavoriteIconModel(favorite(), { faviconBaseUrl: "" });
    assert.equal(model.type, "letter");
    assert.equal(model.letter, "D");
  });

  it("uses the custom image URL in custom mode", () => {
    const model = getFavoriteIconModel(
      favorite({ iconMode: "custom", customIconUrl: "https://x.test/i.png" }),
      { faviconBaseUrl: BASE }
    );
    assert.equal(model.type, "image");
    assert.equal(model.src, "https://x.test/i.png");
  });

  it("returns a letter in letter mode", () => {
    const model = getFavoriteIconModel(favorite({ iconMode: "letter" }), {
      faviconBaseUrl: BASE
    });
    assert.equal(model.type, "letter");
    assert.equal(model.letter, "D");
  });
});

describe("getFavoriteLetter", () => {
  it("uppercases the first character of the label", () => {
    assert.equal(getFavoriteLetter(favorite({ label: "notion" })), "N");
  });
});
