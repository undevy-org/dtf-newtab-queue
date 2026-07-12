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

  it("lets favorite URL and custom-icon fields reach service normalization without native URL validation", async () => {
    const code = await source();
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

  it("renders tile size from data and reuses the shared icon module for the gear and panel controls", async () => {
    const code = await source();
    assert.match(code, /from "\.\/icons\.js"/);
    assert.match(code, /dataset\.tileSize = item\.tileSize === "wide" \? "wide" : "square";/);
    assert.match(code, /createIconNode\("settings"/);
    assert.match(code, /createIconNode\("chevronLeft"\)/);
    assert.match(code, /createIconNode\("chevronRight"\)/);
    assert.match(code, /createIconNode\("pencil"\)/);
    assert.doesNotMatch(code, /"⚙"/);
    assert.doesNotMatch(code, /"‹"/);
    assert.doesNotMatch(code, /"›"/);
    assert.doesNotMatch(code, /"✎"/);
  });

  it("merges add and edit into one favorite form component", async () => {
    const code = await source();
    assert.doesNotMatch(code, /function createAddForm/);
    assert.doesNotMatch(code, /function createEditForm/);
    assert.match(code, /function createFavoriteForm\(item\)/);
  });

  it("builds icon/color/size choices as native radiogroups instead of <select>", async () => {
    const code = await source();
    assert.doesNotMatch(code, /createNode\("select"/);
    assert.match(code, /function createSegmentedControl\(/);
    assert.match(code, /input\.type = "radio";/);
  });

  it("reads a single form payload shape shared by add and edit submits", async () => {
    const code = await source();
    assert.match(code, /function readFavoriteFormPayload\(data\)/);
    assert.match(code, /tileSize: data\.get\("tileSize"\) === "wide" \? "wide" : "square"/);
  });

  it("gives every panel action button a leading icon instead of bare text", async () => {
    const code = await source();
    assert.match(code, /createIconButton\("button button--primary", "Добавить ссылку", "plus"\)/);
    assert.match(code, /createIconButton\("button", "Готово", "check"\)/);
    assert.match(code, /createIconButton\("button button--danger", "Удалить", "trash2"\)/);
  });

  it("drops the dead min-width already overridden for every .favorite-input use site", async () => {
    const css = await readFile(new URL("../src/newtab.css", import.meta.url), "utf8");
    assert.doesNotMatch(css, /min-width: min\(320px, 100%\);/);
  });

  it("links each form row's label to its control for assistive tech", async () => {
    const code = await source();
    assert.match(code, /labelSpan\.id = `favorite-form-row-label-\$\{formRowIdSeq\+\+\}`;/);
    assert.match(code, /setAttribute\("aria-labelledby", labelSpan\.id\)/);
  });

  it("stores favorites in chrome.storage.sync while the queue stays on chrome.storage.local", async () => {
    const code = await source();
    assert.match(code, /const localStorageArea = chromeApi\?\.storage\?\.local;/);
    assert.match(code, /const syncStorageArea = chromeApi\?\.storage\?\.sync;/);
    assert.match(code, /createFavoritesStore\(syncStorageArea\)/);
    assert.match(code, /createQueueStore\(localStorageArea\)/);
  });

  it("migrates legacy local favorites into sync storage before the first favorites read", async () => {
    const code = await source();
    assert.match(code, /from "\.\/favoritesStore\.js"/);
    assert.match(code, /migrateLegacyFavorites\(/);
  });

  it("skips the empty favorites-grid box when there are no favorites, so the gear sits flush against the bar padding", async () => {
    const code = await source();
    assert.match(code, /if \(items\.length > 0\) \{\s*const list = createNode\("div", "favorites-grid"\);/);
  });

  it("locks the news card to one constant height, with the title always reserving exactly 3 lines", async () => {
    const css = await readFile(new URL("../src/newtab.css", import.meta.url), "utf8");

    assert.match(
      css,
      /\.title\s*\{[^}]*min-height: calc\(1\.22em \* 3\);[^}]*-webkit-line-clamp: 3;[^}]*-webkit-box-orient: vertical;[^}]*overflow: hidden;[^}]*\}/s
    );
    assert.match(
      css,
      /\.panel\s*\{[^}]*height: 282px;[^}]*align-content: start;[^}]*\}/s
    );

    const mobileBlock = css.slice(css.indexOf("@media (max-width: 600px)"));
    assert.match(mobileBlock, /\.panel\s*\{[^}]*height: 356px;[^}]*\}/s);
  });

  it("shows a themed popover with the full title only when the 3-line clamp actually truncated it", async () => {
    const code = await source();
    assert.match(code, /function createTitleNode\(title\)/);
    assert.match(code, /function attachTruncatedTitlePopover\(titleNode, fullTitle\)/);
    assert.match(code, /titleNode\.scrollHeight <= titleNode\.clientHeight \+ 1/);
    assert.match(code, /titleNode\.tabIndex = 0;/);
    assert.match(code, /titleNode\.setAttribute\("aria-label", title\)/);
    assert.match(code, /titleNode\.after\(popover\)/);

    const css = await readFile(new URL("../src/newtab.css", import.meta.url), "utf8");
    assert.match(css, /\.title-wrap\s*\{[^}]*position: relative;[^}]*\}/s);
    assert.match(
      css,
      /\.title:hover \+ \.title-popover,\s*\.title:focus-visible \+ \.title-popover\s*\{[^}]*display: block;[^}]*\}/s
    );
  });

  it("caps meta and status text at 2 lines to bound unbounded error messages", async () => {
    const css = await readFile(new URL("../src/newtab.css", import.meta.url), "utf8");

    assert.match(
      css,
      /\.meta,\s*\n\s*\.status\s*\{[^}]*display: -webkit-box;[^}]*-webkit-line-clamp: 2;[^}]*-webkit-box-orient: vertical;[^}]*overflow: hidden;[^}]*\}/s
    );
  });

  it("gives the three milestone states (loading, fork, archive-ended) a centered icon badge instead of an empty 3-line title reservation", async () => {
    const code = await source();
    assert.match(
      code,
      /function createMilestoneTitleNode\(title, iconName, \{ spin = false \} = \{\}\)/
    );
    assert.match(code, /createNode\("div", "title-wrap title-wrap--milestone"\)/);
    assert.match(code, /createNode\("div", "milestone-badge"\)/);
    assert.match(code, /createNode\("h1", "milestone-title", title\)/);
    assert.match(
      code,
      /createIconNode\(iconName, \{ size: 24, className: spin \? "icon--spin" : "" \}\)/
    );
    assert.match(code, /icon = null,\s*iconSpin = false/);
    assert.match(
      code,
      /fragment\.appendChild\(createMilestoneTitleNode\(title, icon, \{ spin: iconSpin \}\)\);/
    );
    assert.match(
      code,
      /function renderLoading\([^)]*\)\s*\{[^}]*icon: "loaderCircle",\s*iconSpin: true[^}]*\}/
    );
    assert.match(
      code,
      /function renderArchiveEnded\([^)]*\)\s*\{[^}]*icon: "checkCheck",[^}]*\}/
    );
    assert.match(
      code,
      /function renderFork\([^)]*\)\s*\{[^}]*icon: "check",[^}]*\}/
    );

    const css = await readFile(new URL("../src/newtab.css", import.meta.url), "utf8");
    assert.match(
      css,
      /\.title-wrap--milestone\s*\{[^}]*font-size: 26px;[^}]*min-height: calc\(1\.22em \* 3\);[^}]*text-align: center;[^}]*\}/s
    );
    assert.match(
      css,
      /\.milestone-badge\s*\{[^}]*border-radius: 50%;[^}]*background: var\(--bg\);[^}]*\}/s
    );
    assert.match(
      css,
      /\.milestone-title\s*\{[^}]*font-size: 26px;[^}]*font-weight: 700;[^}]*\}/s
    );

    const mobileBlock = css.slice(css.indexOf("@media (max-width: 600px)"));
    assert.match(mobileBlock, /\.title-wrap--milestone\s*\{[^}]*font-size: 22px;[^}]*\}/s);
    assert.match(
      mobileBlock,
      /\.milestone-badge\s*\{[^}]*width: 44px;[^}]*height: 44px;[^}]*\}/s
    );
  });

  it("spins only the loading icon, and freezes it under prefers-reduced-motion", async () => {
    const css = await readFile(new URL("../src/newtab.css", import.meta.url), "utf8");
    assert.match(
      css,
      /@keyframes milestone-spin\s*\{\s*to\s*\{\s*transform: rotate\(360deg\);/
    );
    assert.match(
      css,
      /\.icon--spin\s*\{[^}]*animation: milestone-spin 0\.9s linear infinite;[^}]*\}/s
    );
    assert.match(
      css,
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.icon--spin\s*\{\s*animation: none;/
    );
  });
});
