import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractImageBackgroundColor,
  fallbackColorForDomain,
  pickDominantColorFromPixels,
  readableTextColor
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

  it("returns readable text colors based on background luminance", () => {
    assert.equal(readableTextColor("#111318"), "#ffffff");
    assert.equal(readableTextColor("#f3f5f7"), "#111318");
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
});
