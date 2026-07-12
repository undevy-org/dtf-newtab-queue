import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const NEWTAB_SOURCE = new URL("../src/newtab.js", import.meta.url);

async function source() {
  return readFile(NEWTAB_SOURCE, "utf8");
}

describe("newtab favorites source", () => {
  it("drives the favorites UI from the pure state machine, not a mode string", async () => {
    const code = await source();
    assert.match(code, /from "\.\/favoritesUiState\.js"/);
    assert.match(code, /let favoritesUi = createInitialFavoritesUiState\(\);/);
    assert.doesNotMatch(code, /favoritesMode/);
  });

  it("has no add tile — the only management entry is the settings gear", async () => {
    const code = await source();
    assert.doesNotMatch(code, /createFavoriteAddButton/);
    assert.match(code, /data-favorite-action/);
    assert.match(code, /"open-settings"/);
    assert.match(code, /"close-settings"/);
  });

  it("renders the toolbar and the settings panel into separate roots", async () => {
    const code = await source();
    assert.match(code, /querySelector\("#favorites"\)/);
    assert.match(code, /querySelector\("#favorites-panel"\)/);
  });

  it("closes the panel on Escape and returns focus to the gear", async () => {
    const code = await source();
    assert.match(code, /addEventListener\("keydown"/);
    assert.match(code, /"Escape"/);
    assert.match(code, /\.focus\(\)/);
  });

  it("lets favorite URL fields reach service normalization without native URL validation", async () => {
    const code = await source();
    assert.match(code, /input\.type = "text";\s+input\.inputMode = "url";/);
    assert.match(code, /\burl\.type = "text";\s+url\.inputMode = "url";/);
    assert.match(code, /customIconUrl\.type = "text";\s+customIconUrl\.inputMode = "url";/);
  });

  it("blocks favorites actions while a request is in flight", async () => {
    const code = await source();
    assert.match(code, /let favoritesBusy = false;/);
    assert.match(code, /let favoritesGeneration = 0;/);
    assert.match(code, /function startFavoritesAction\(\)/);
    assert.match(code, /function finishFavoritesAction\(generation, applyResult\)/);
    assert.match(code, /\|\| favoritesBusy\)\s*\{\s*return;/);
  });

  it("bootstraps the favorites bar independently of the queue widget's #app guard", async () => {
    const code = await source();
    assert.match(code, /if \(favoritesRoot\) \{/);
    assert.match(code, /if \(app\) \{/);
  });

  it("tags every icon with its source for observability", async () => {
    const code = await source();
    assert.match(code, /data-icon-source|dataset\.iconSource/);
  });

  it("re-checks the item is still auto before a late auto-accent write", async () => {
    const code = await source();
    assert.match(code, /backgroundColorSource !== "auto"/);
  });

  it("only samples icon pixels for CORS-safe sources, never arbitrary custom icon URLs", async () => {
    const code = await source();
    assert.match(code, /if \(!iconModel\.sampleable\) \{\s*return fallback;/);
    assert.doesNotMatch(code, /iconModel\.type === "image" \? iconModel\.src : ""/);
  });

  it("closes the settings panel on an outside pointerdown", async () => {
    const code = await source();
    assert.match(code, /addEventListener\("pointerdown"/);
    assert.match(code, /\.contains\(event\.target\)/);
  });

  it("consumes --favorite-accent-rgb via legacy rgba() so comma channels stay valid CSS", async () => {
    const css = await readFile(new URL("../src/newtab.css", import.meta.url), "utf8");
    assert.doesNotMatch(css, /rgb\(var\(--favorite-accent-rgb\)\s*\//);
    assert.match(css, /rgba\(var\(--favorite-accent-rgb\),/);
  });

  it("does not render a literal DTF label in the news card shell", async () => {
    const code = await source();
    assert.doesNotMatch(code, /"eyebrow"/);
    assert.doesNotMatch(code, /\["DTF"\]/);
  });

  it("does not flash a DTF eyebrow in the pre-render fallback shell", async () => {
    const html = await readFile(new URL("../src/newtab.html", import.meta.url), "utf8");
    assert.doesNotMatch(html, /<p class="eyebrow">/);
  });

  it("drops the now-unused eyebrow style once the DTF label is removed", async () => {
    const css = await readFile(new URL("../src/newtab.css", import.meta.url), "utf8");
    assert.doesNotMatch(css, /\.eyebrow/);
  });

  it("uses a black/white accent instead of blue, with a theme-aware button contrast color", async () => {
    const css = await readFile(new URL("../src/newtab.css", import.meta.url), "utf8");
    assert.match(css, /--primary: #111318;/);
    assert.match(css, /--primary-contrast: #ffffff;/);
    assert.doesNotMatch(css, /--primary: #1473e6/);
    assert.doesNotMatch(css, /--primary: #4d9aff/);
    assert.match(css, /\.button--primary\s*\{[^}]*color: var\(--primary-contrast\);/s);
  });

  it("lets the toolbar hug its content instead of a fixed width, and keeps the settings panel above it", async () => {
    const css = await readFile(new URL("../src/newtab.css", import.meta.url), "utf8");
    assert.match(css, /\.favorites-bar\s*\{[^}]*width: fit-content;/s);
    assert.match(css, /\.favorites-bar\s*\{[^}]*--favorite-tile-height: 52px;/s);
    assert.doesNotMatch(css, /\.favorites-grid\s*\{[^}]*--favorite-tile-height/s);
    assert.match(css, /\.favorites-panel\s*\{[^}]*z-index: 40;/s);
  });
});
