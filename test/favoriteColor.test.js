import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractImageBackgroundColor,
  fallbackColorForDomain,
  hexToRgbChannels,
  normalizeAccentLightness,
  pickDominantColorFromPixels
} from "../src/favoriteColor.js";

describe("favoriteColor", () => {
  it("returns stable palette hex colors per domain", () => {
    const exampleColor = fallbackColorForDomain("example.com");
    const dtfColor = fallbackColorForDomain("dtf.ru");

    assert.match(exampleColor, /^#[0-9a-f]{6}$/);
    assert.match(dtfColor, /^#[0-9a-f]{6}$/);
    assert.equal(fallbackColorForDomain("EXAMPLE.com"), exampleColor);
    assert.notEqual(exampleColor, dtfColor);
  });

  it("picks the dominant quantized color while ignoring near-white and transparent pixels", () => {
    const pixels = [
      255, 255, 255, 255,
      36, 41, 47, 255,
      36, 41, 47, 255,
      36, 41, 47, 255,
      9, 105, 218, 40,
      9, 105, 218, 255
    ];

    assert.equal(pickDominantColorFromPixels(pixels), "#24292f");
  });

  it("returns null when pixels are only transparent or near-white", () => {
    const pixels = [
      255, 255, 255, 255,
      244, 245, 246, 255,
      36, 41, 47, 127
    ];

    assert.equal(pickDominantColorFromPixels(pixels), null);
  });

  it("ignores neutral browser fallback gray when a real accent color is present", () => {
    const pixels = [
      95, 99, 104, 255,
      95, 99, 104, 255,
      95, 99, 104, 255,
      9, 105, 218, 255
    ];

    assert.equal(pickDominantColorFromPixels(pixels), "#0969da");
  });

  it("extracts the dominant background color from image pixels", async () => {
    const pixels = new Uint8ClampedArray([
      36, 41, 47, 255,
      36, 41, 47, 255,
      9, 105, 218, 255,
      255, 255, 255, 255
    ]);
    const calls = [];
    const image = { width: 100, height: 50 };
    const context = {
      drawImage(...args) {
        calls.push(args);
      },
      getImageData() {
        return { data: pixels };
      }
    };

    const color = await extractImageBackgroundColor("https://example.com/icon.png", {
      loadImage: async () => image,
      createCanvas(width, height) {
        assert.equal(width, 2);
        assert.equal(height, 2);
        return {
          getContext(type) {
            assert.equal(type, "2d");
            assert.deepEqual(arguments[1], { willReadFrequently: true });
            return context;
          }
        };
      },
      sampleSize: 2
    });

    assert.equal(color, "#24292f");
    assert.deepEqual(calls, [[image, 0, 0, 2, 2]]);
  });

  it("returns null when image color extraction fails", async () => {
    const color = await extractImageBackgroundColor("https://example.com/icon.png", {
      loadImage: async () => {
        throw new Error("load failed");
      },
      createCanvas() {
        throw new Error("should not create canvas");
      }
    });

    assert.equal(color, null);
  });

  it("rejects missing extraction adapters", async () => {
    await assert.rejects(
      () => extractImageBackgroundColor("https://example.com/icon.png", {}),
      /loadImage must be a function/
    );
    await assert.rejects(
      () =>
        extractImageBackgroundColor("https://example.com/icon.png", {
          loadImage: async () => ({})
        }),
      /createCanvas must be a function/
    );
  });
});

describe("hexToRgbChannels", () => {
  it("returns comma-separated channels for a valid hex", () => {
    assert.equal(hexToRgbChannels("#69a8ff"), "105, 168, 255");
  });

  it("is case-insensitive", () => {
    assert.equal(hexToRgbChannels("#69A8FF"), "105, 168, 255");
  });

  it("throws on an invalid hex", () => {
    assert.throws(() => hexToRgbChannels("nope"), /hex color/);
  });
});

describe("normalizeAccentLightness", () => {
  const lightnessOf = (hex) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return (Math.max(r, g, b) + Math.min(r, g, b)) / 2 / 255;
  };

  it("lightens a too-dark accent into the visible band", () => {
    const result = normalizeAccentLightness("#24292f");
    assert.notEqual(result, "#24292f");
    assert.ok(lightnessOf(result) >= 0.44, `lightness ${lightnessOf(result)}`);
    assert.match(result, /^#[0-9a-f]{6}$/);
  });

  it("darkens a too-light accent into the visible band", () => {
    const result = normalizeAccentLightness("#f3f5f7");
    assert.notEqual(result, "#f3f5f7");
    assert.ok(lightnessOf(result) <= 0.71, `lightness ${lightnessOf(result)}`);
    assert.match(result, /^#[0-9a-f]{6}$/);
  });

  it("leaves a mid-lightness accent unchanged", () => {
    assert.equal(normalizeAccentLightness("#4d9aff"), "#4d9aff");
  });
});
