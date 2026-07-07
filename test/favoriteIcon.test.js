import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getFavoriteIconModel,
  getFavoriteLetter,
  getFaviconUrl
} from "../src/favoriteIcon.js";

function favorite(overrides = {}) {
  return {
    url: "https://example.com/path?q=1",
    label: "Example",
    domain: "example.com",
    iconMode: "favicon",
    customIconUrl: null,
    ...overrides
  };
}

describe("favoriteIcon", () => {
  it("builds the Manifest V3 favicon endpoint", () => {
    assert.equal(
      getFaviconUrl({
        extensionId: "abc123",
        pageUrl: "https://example.com/path?q=1",
        size: 64
      }),
      "chrome-extension://abc123/_favicon/?pageUrl=https%3A%2F%2Fexample.com%2Fpath%3Fq%3D1&size=64"
    );
  });

  it("returns a custom image model when custom icon mode has a URL", () => {
    assert.deepEqual(
      getFavoriteIconModel(
        favorite({
          iconMode: "custom",
          customIconUrl: "https://cdn.example.com/icon.png"
        }),
        { extensionId: "abc123" }
      ),
      {
        type: "image",
        src: "https://cdn.example.com/icon.png",
        alt: "Example"
      }
    );
  });

  it("returns a favicon image model when favicon mode has an extension ID", () => {
    assert.deepEqual(
      getFavoriteIconModel(favorite(), { extensionId: "abc123" }),
      {
        type: "image",
        src: "chrome-extension://abc123/_favicon/?pageUrl=https%3A%2F%2Fexample.com%2Fpath%3Fq%3D1&size=64",
        alt: "Example"
      }
    );
  });

  it("returns a letter model for letter mode", () => {
    assert.deepEqual(
      getFavoriteIconModel(favorite({ iconMode: "letter" }), {
        extensionId: "abc123"
      }),
      {
        type: "letter",
        letter: "E",
        alt: "Example"
      }
    );
  });

  it("returns a letter model when favicon mode is missing an extension ID", () => {
    assert.deepEqual(
      getFavoriteIconModel(favorite(), { extensionId: "" }),
      {
        type: "letter",
        letter: "E",
        alt: "Example"
      }
    );
  });

  it("uses the first domain letter when the label is empty-like", () => {
    assert.equal(getFavoriteLetter(favorite({ label: "   ", domain: "dtf.ru" })), "D");
  });

  it("uses a question mark when label and domain are empty-like", () => {
    assert.equal(getFavoriteLetter(favorite({ label: " ", domain: "\t" })), "?");
  });
});
