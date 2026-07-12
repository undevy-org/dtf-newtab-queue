# Toolbar & Form Polish Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship eight small, mostly-independent UI/UX fixes to the pinned favorites toolbar and the DTF news card — a user-chosen tile aspect ratio, a size-matched settings icon, a black/white accent instead of blue, real vendored SVG icons instead of glyphs, a settings panel that stacks above the toolbar, no more literal "DTF" label, a content-hugging toolbar width, and a redesigned unified add/edit form.

**Architecture:** An additive, backward-compatible schema change (`tileSize`, optional field, no version bump) feeds a rewritten favorites renderer in `newtab.js`. A new dependency-free `src/icons.js` module vendors 8 Lucide SVGs as local string constants. Color, z-index, and width fixes are CSS-only. The two divergent add/edit form-building functions merge into one `createFavoriteForm(item)`, built from small reusable row and segmented-control helpers, replacing the current unlabeled `<select>`-based flat list.

**Tech Stack:** Chrome Manifest V3 extension, vanilla ES modules (`<script type="module">`, no bundler), `node:test` (no test dependencies, no jsdom). Storage via `chrome.storage.local`.

Design spec: [`docs/superpowers/specs/2026-07-12-toolbar-polish-batch-design.md`](../specs/2026-07-12-toolbar-polish-batch-design.md).

## Global Constraints

- **Every task must leave `npm test` and `npm run check` green** before its commit.
- **No new runtime dependencies.** `package.json` stays dependency-free. There is no bundler, so a bare `import "lucide"` would have nothing to resolve against in the browser — icons are hand-copied Lucide SVG markup vendored into `src/icons.js`, not an installed package.
- **Storage schema stays version 1.** `FAVORITES_VERSION = 1` in `src/favoritesStore.js` does not change. The new `tileSize` field is additive and optional — it is never added to `isFavoriteItem`'s `requiredFields` array — so favorites saved before this batch stay valid without a migration.
- **Language:** all user-facing strings are Russian, matching existing copy style exactly (see existing labels like "Сохранить", "Отмена", "Удалить").
- **No jsdom, no DOM in `node:test`.** This repo has no DOM available in its test runner. DOM-manipulating code in `newtab.js` and `src/icons.js`'s `createIconNode` is verified with source-regex tests against the raw file text (see `test/newtabSource.test.js`'s existing pattern) — never by calling `document.createElement` from a test. Only plain-data code (e.g. the icon path strings) gets executed directly in tests.
- **Commit after every task** with the task's own commit message; do not batch multiple tasks into one commit.

---

## Task 1: `tileSize` field — schema and service

**Files:**
- Modify: `src/favoritesShared.js`
- Modify: `src/favoritesStore.js`
- Modify: `src/favoritesService.js`
- Modify: `test/favoritesStore.test.js`
- Modify: `test/favoritesService.test.js`

**Interfaces:**
- Produces: `TILE_SIZES` (a `Set` of `"square" | "wide"`) exported from `src/favoritesShared.js`. Favorite items may carry an optional `tileSize` field. `favoritesService.addFavorite(input)` always sets `tileSize` on the created item (defaults to `"square"`). `favoritesService.updateFavorite(id, input)` sets `tileSize` when `input.tileSize` is present.
- Consumes: nothing from other tasks.

- [ ] **Step 1: Write the failing schema test**

In `test/favoritesStore.test.js`, add this test inside the existing `describe("favoritesStore", ...)` block, right after the `"rejects invalid favorites state shapes"` test (currently ending around line 72):

```js
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
```

Do **not** add `tileSize` to the `favorite()` helper's defaults — its absence is exactly the legacy-item case this test locks in.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/favoritesStore.test.js`
Expected: FAIL — the `"wide"`/`"square"` cases pass by accident (unknown fields are currently ignored), but the last assertion (`tileSize: "huge"` should be rejected) fails because nothing validates `tileSize` yet.

- [ ] **Step 3: Add `TILE_SIZES` to the shared constants**

In `src/favoritesShared.js`, add this line after `export const BACKGROUND_COLOR_SOURCES = new Set(["auto", "manual"]);` (currently line 2):

```js
export const TILE_SIZES = new Set(["square", "wide"]);
```

- [ ] **Step 4: Validate the optional field in the store**

In `src/favoritesStore.js`, change the import block (currently lines 8-12):

```js
import {
  BACKGROUND_COLOR_SOURCES,
  HEX_COLOR_VALIDATION_PATTERN,
  ICON_MODES
} from "./favoritesShared.js";
```

to:

```js
import {
  BACKGROUND_COLOR_SOURCES,
  HEX_COLOR_VALIDATION_PATTERN,
  ICON_MODES,
  TILE_SIZES
} from "./favoritesShared.js";
```

Then add this function right after `isCustomIconUrl` (currently lines 41-43):

```js
function isOptionalTileSize(value) {
  return !Object.hasOwn(value, "tileSize") || TILE_SIZES.has(value.tileSize);
}
```

Then add `isOptionalTileSize(value) &&` to the boolean chain inside `isFavoriteItem` (currently lines 59-73), right after the `isCustomIconUrl(value.customIconUrl) &&` line:

```js
  return (
    isRecord(value) &&
    hasOwnFields(value, requiredFields) &&
    isNonEmptyString(value.id) &&
    isHttpUrl(value.url) &&
    isNonEmptyString(value.label) &&
    isNonEmptyString(value.domain) &&
    ICON_MODES.has(value.iconMode) &&
    isCustomIconUrl(value.customIconUrl) &&
    isOptionalTileSize(value) &&
    typeof value.backgroundColor === "string" &&
    HEX_COLOR_VALIDATION_PATTERN.test(value.backgroundColor) &&
    BACKGROUND_COLOR_SOURCES.has(value.backgroundColorSource) &&
    isParseableTimestamp(value.createdAt) &&
    isParseableTimestamp(value.updatedAt)
  );
```

Note `tileSize` is **not** added to the `requiredFields` array a few lines above — that is what keeps legacy items (without the field) valid.

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test test/favoritesStore.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/favoritesShared.js src/favoritesStore.js test/favoritesStore.test.js
git commit -m "feat: validate an optional tileSize field on favorite items"
```

- [ ] **Step 7: Write the failing service tests**

In `test/favoritesService.test.js`, first fix the two existing `deepEqual` assertions that will now fail because `addFavorite`/`updateFavorite` will start always including `tileSize`.

Change the `"adds a favorite with normalized defaults and persists it"` test (currently lines 135-155) so the expected object includes `tileSize`:

```js
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
        tileSize: "square",
        createdAt: NOW,
        updatedAt: NOW
      }
    ]);
    assert.deepEqual(await store.getState(), state);
  });
```

Change the `"updates favorite fields"` test (currently lines 169-195) the same way:

```js
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
      tileSize: "square",
      createdAt: NOW,
      updatedAt: NOW
    });
    assert.deepEqual(await store.getState(), state);
  });
```

Then add three new tests, right after `"preserves a manual background color when color fields are omitted"` (currently ending around line 221):

```js
  it("defaults tileSize to square when adding, and allows choosing wide", async () => {
    const { service } = await createHarness();

    const defaulted = await service.addFavorite({ url: "example.com" });
    assert.equal(defaulted.items[0].tileSize, "square");

    const wide = await service.addFavorite({
      url: "wide.example.com",
      tileSize: "wide"
    });
    assert.equal(wide.items[1].tileSize, "wide");
  });

  it("updates tileSize", async () => {
    const { service } = await createHarness();
    await service.addFavorite({ url: "example.com" });

    const state = await service.updateFavorite("fav-1", { tileSize: "wide" });
    assert.equal(state.items[0].tileSize, "wide");
  });

  it("rejects an unsupported tileSize", async () => {
    const { service } = await createHarness();

    await assert.rejects(
      () => service.addFavorite({ url: "example.com", tileSize: "huge" }),
      /Choose a supported tile size/
    );
  });
```

- [ ] **Step 8: Run the tests to verify they fail**

Run: `node --test test/favoritesService.test.js`
Expected: FAIL — the two modified `deepEqual` tests fail because the real items don't have `tileSize` yet (mismatched shape), and the three new tests fail because `tileSize` isn't accepted/defaulted anywhere yet.

- [ ] **Step 9: Implement in the service**

In `src/favoritesService.js`, change the import block (currently lines 3-8):

```js
import {
  BACKGROUND_COLOR_SOURCES,
  HEX_COLOR_VALIDATION_PATTERN,
  ICON_MODES,
  trimString
} from "./favoritesShared.js";
```

to:

```js
import {
  BACKGROUND_COLOR_SOURCES,
  HEX_COLOR_VALIDATION_PATTERN,
  ICON_MODES,
  TILE_SIZES,
  trimString
} from "./favoritesShared.js";
```

Add this function right after `normalizeBackgroundColorSource` (currently lines 101-107):

```js
function normalizeTileSize(tileSize) {
  if (!TILE_SIZES.has(tileSize)) {
    throw new Error("Choose a supported tile size");
  }

  return tileSize;
}
```

In `addFavorite` (currently lines 161-195), add a `tileSize` field to the created item, right after `backgroundColorSource: deriveBackgroundColorSource(payload, "auto"),`:

```js
        const item = {
          id: createId(),
          url: normalizedUrl.url,
          label: normalizeLabel(payload.label, normalizedUrl.domain),
          domain: normalizedUrl.domain,
          iconMode: normalizeIconMode(payload.iconMode ?? "favicon"),
          customIconUrl: normalizeNullableImageUrl(payload.customIconUrl),
          backgroundColor: normalizeBackgroundColor(
            payload.backgroundColor,
            normalizedUrl.domain,
            defaultBackgroundColor
          ),
          backgroundColorSource: deriveBackgroundColorSource(payload, "auto"),
          tileSize: normalizeTileSize(payload.tileSize ?? "square"),
          createdAt,
          updatedAt: createdAt
        };
```

In `updateFavorite` (currently lines 197-257), add a `tileSize` block right after the `backgroundColorSource` handling and before `nextItem.updatedAt = updatedAt;`:

```js
        if (Object.hasOwn(payload, "tileSize")) {
          nextItem.tileSize = normalizeTileSize(payload.tileSize);
        }

        nextItem.updatedAt = updatedAt;
```

- [ ] **Step 10: Run the tests to verify they pass**

Run: `node --test test/favoritesService.test.js test/favoritesStore.test.js`
Expected: PASS

- [ ] **Step 11: Run the full suite and the syntax check**

Run: `npm test && npm run check`
Expected: all green (other test files are untouched and unaffected by an additive optional field).

- [ ] **Step 12: Commit**

```bash
git add src/favoritesService.js test/favoritesService.test.js
git commit -m "feat: default and update tileSize through favoritesService"
```

---

## Task 2: Vendored icon module (`src/icons.js`)

**Files:**
- Create: `src/icons.js`
- Create: `test/icons.test.js`

**Interfaces:**
- Produces: `ICON_PATHS` (object mapping icon name → inner SVG markup string) and `createIconNode(name, { size = 18 } = {})` returning a `<span class="icon" aria-hidden="true">` wrapping an inline `<svg>`, both exported from `src/icons.js`. Icon names used elsewhere in this batch: `"settings"`, `"chevronLeft"`, `"chevronRight"`, `"pencil"`, `"plus"`, `"check"`, `"x"`, `"trash2"`.
- Consumes: nothing.

The SVG markup below is copied verbatim from Lucide (`https://lucide.dev`, ISC License, Copyright (c) Lucide Icons and Contributors), fetched directly from `https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/<name>.svg` for each icon used here.

- [ ] **Step 1: Write the failing test**

Create `test/icons.test.js`:

```js
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFile } from "node:fs/promises";
import { ICON_PATHS, createIconNode } from "../src/icons.js";

const ICON_NAMES = [
  "settings",
  "chevronLeft",
  "chevronRight",
  "pencil",
  "plus",
  "check",
  "x",
  "trash2"
];

describe("icons", () => {
  it("has SVG path/circle markup for every icon the toolbar and forms use", () => {
    for (const name of ICON_NAMES) {
      assert.equal(typeof ICON_PATHS[name], "string", name);
      assert.match(ICON_PATHS[name], /<(path|circle)\b/, name);
    }
  });

  it("throws a clear error for an unknown icon name", () => {
    assert.throws(() => createIconNode("nope"), /Unknown icon: nope/);
  });

  it("is vendored locally with no new runtime dependency", async () => {
    const packageJson = await readFile(
      new URL("../package.json", import.meta.url),
      "utf8"
    );
    assert.doesNotMatch(packageJson, /lucide/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/icons.test.js`
Expected: FAIL with "Cannot find module '../src/icons.js'" (the file doesn't exist yet).

- [ ] **Step 3: Create the icon module**

Create `src/icons.js`:

```js
// SVG icon set vendored from Lucide (https://lucide.dev), ISC License,
// Copyright (c) Lucide Icons and Contributors. Copied by hand: this repo has
// no bundler, so a bare `import "lucide"` would have nothing to resolve
// against in the browser without introducing a build step.

export const ICON_PATHS = {
  settings:
    '<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/>',
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  pencil:
    '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  trash2:
    '<path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'
};

export function createIconNode(name, { size = 18 } = {}) {
  const inner = ICON_PATHS[name];

  if (!inner) {
    throw new Error(`Unknown icon: ${name}`);
  }

  const wrapper = document.createElement("span");
  wrapper.className = "icon";
  wrapper.setAttribute("aria-hidden", "true");
  wrapper.innerHTML =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
    `viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ` +
    `stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

  return wrapper;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/icons.test.js`
Expected: PASS

- [ ] **Step 5: Run the full suite and the syntax check**

Run: `npm test && npm run check`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/icons.js test/icons.test.js
git commit -m "feat: add a locally-vendored Lucide icon module"
```

---

## Task 3: Remove the literal "DTF" label

**Files:**
- Modify: `src/newtab.js`
- Modify: `src/newtab.html`
- Modify: `src/newtab.css`
- Modify: `test/newtabSource.test.js`

**Interfaces:** none (pure removal, no new exports/consumers).

- [ ] **Step 1: Write the failing tests**

In `test/newtabSource.test.js`, add these three tests at the end of the `describe("newtab favorites source", ...)` block (after the last existing `it`, currently ending at line 82):

```js

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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/newtabSource.test.js`
Expected: FAIL on all three new assertions (the eyebrow markup, the `"DTF"` seed, and the `.eyebrow` CSS rule are all still present).

- [ ] **Step 3: Remove the eyebrow line and the "DTF" meta seed from `newtab.js`**

In `src/newtab.js`, change `buildMeta` (currently lines 85-98) so `parts` starts empty:

```js
function buildMeta(item, backlogCount) {
  const parts = [];

  const date = formatDate(item.date);
  if (date) {
    parts.push(date);
  }

  if (backlogCount > 0) {
    parts.push(`В очереди: ${backlogCount}`);
  }

  return parts.join(" · ");
}
```

In `renderShell` (currently lines 100-134), delete this line entirely:

```js
  fragment.appendChild(createNode("p", "eyebrow", "DTF"));
```

so the function starts:

```js
function renderShell({ title, meta = "", status = null, error = null, actions = [] }) {
  if (!app) {
    return;
  }

  const fragment = document.createDocumentFragment();

  fragment.appendChild(createNode("h1", "title", title));
```

- [ ] **Step 4: Remove the eyebrow line from the static fallback shell**

In `src/newtab.html`, delete this line (currently line 19):

```html
        <p class="eyebrow">DTF</p>
```

so the `#app` section reads:

```html
      <section class="panel" id="app">
        <h1 class="title">Загружаю новость...</h1>
      </section>
```

- [ ] **Step 5: Remove the now-unused `.eyebrow` CSS rule**

In `src/newtab.css`, delete this rule (currently lines 336-343):

```css
.eyebrow {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0;
  text-transform: uppercase;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test test/newtabSource.test.js`
Expected: PASS

- [ ] **Step 7: Run the full suite and the syntax check**

Run: `npm test && npm run check`
Expected: all green.

- [ ] **Step 8: Manual check**

Load the unpacked extension, open a new tab, confirm the news card shows only the headline and (if present) the date/queue-count meta line, with no "DTF" text anywhere in the card.

- [ ] **Step 9: Commit**

```bash
git add src/newtab.js src/newtab.html src/newtab.css test/newtabSource.test.js
git commit -m "fix: remove the literal DTF label from the news card"
```

---

## Task 4: Black/white accent instead of blue

**Files:**
- Modify: `src/newtab.css`
- Modify: `test/newtabSource.test.js`

**Interfaces:** none.

- [ ] **Step 1: Write the failing test**

In `test/newtabSource.test.js`, add this test after the ones added in Task 3:

```js

  it("uses a black/white accent instead of blue, with a theme-aware button contrast color", async () => {
    const css = await readFile(new URL("../src/newtab.css", import.meta.url), "utf8");
    assert.match(css, /--primary: #111318;/);
    assert.match(css, /--primary-contrast: #ffffff;/);
    assert.doesNotMatch(css, /--primary: #1473e6/);
    assert.doesNotMatch(css, /--primary: #4d9aff/);
    assert.match(css, /\.button--primary\s*\{[^}]*color: var\(--primary-contrast\);/s);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/newtabSource.test.js`
Expected: FAIL — `--primary` is still blue and `.button--primary` still hardcodes `color: #fff`.

- [ ] **Step 3: Update the light-theme variables**

In `src/newtab.css`, change the `:root` block (currently lines 1-13):

```css
:root {
  color-scheme: light dark;
  --bg: #f3f5f7;
  --panel: #ffffff;
  --text: #111318;
  --muted: #5c6672;
  --border: #d8dee6;
  --primary: #111318;
  --primary-hover: #2a2d33;
  --primary-contrast: #ffffff;
  --danger: #b42318;
  --focus: rgb(0 0 0 / 24%);
  --toolbar-h: 72px;
}
```

- [ ] **Step 4: Update the dark-theme variables**

Change the dark-mode block (currently lines 15-27):

```css
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #14171c;
    --panel: #1d2229;
    --text: #f4f6f8;
    --muted: #a8b0ba;
    --border: #343b45;
    --primary: #f4f6f8;
    --primary-hover: #d9dce0;
    --primary-contrast: #14171c;
    --danger: #ff8a80;
    --focus: rgb(255 255 255 / 28%);
  }
}
```

- [ ] **Step 5: Fix the primary button's text contrast**

Change `.button--primary` (currently lines 399-403):

```css
.button--primary {
  border-color: var(--primary);
  background: var(--primary);
  color: var(--primary-contrast);
}
```

This is the one non-mechanical change: the old rule hardcoded `color: #fff`, which only worked while the background was blue in both themes. Now that the dark-theme background is white, the text needs to flip to a dark color, which `--primary-contrast` provides per theme.

- [ ] **Step 6: Run the test to verify it passes**

Run: `node --test test/newtabSource.test.js`
Expected: PASS

- [ ] **Step 7: Run the full suite and the syntax check**

Run: `npm test && npm run check`
Expected: all green.

- [ ] **Step 8: Manual check**

Load the unpacked extension in both light and dark system themes. Confirm: primary buttons ("Перейти", "Проверить новые", "Добавить ссылку") have a black background with white text in light mode, and a white background with dark text in dark mode. Confirm focus rings and the gear's expanded-state border are black in light mode, white in dark mode. Confirm the "Удалить" button stays red in both themes.

- [ ] **Step 9: Commit**

```bash
git add src/newtab.css test/newtabSource.test.js
git commit -m "feat: switch the UI accent from blue to a theme-aware black/white"
```

---

## Task 5: Toolbar layout — z-index, flexible width, shared tile-height variable

**Files:**
- Modify: `src/newtab.css`
- Modify: `test/newtabSource.test.js`

**Interfaces:**
- Produces: `--favorite-tile-height` is now declared on `.favorites-bar` (previously on `.favorites-grid`) so it is visible to the gear button, which is a sibling of `.favorites-grid`, not a descendant. Task 6 depends on this.
- Consumes: nothing.

- [ ] **Step 1: Write the failing test**

In `test/newtabSource.test.js`, add this test after the one added in Task 4:

```js

  it("lets the toolbar hug its content instead of a fixed width, and keeps the settings panel above it", async () => {
    const css = await readFile(new URL("../src/newtab.css", import.meta.url), "utf8");
    assert.match(css, /\.favorites-bar\s*\{[^}]*width: fit-content;/s);
    assert.match(css, /\.favorites-bar\s*\{[^}]*--favorite-tile-height: 52px;/s);
    assert.doesNotMatch(css, /\.favorites-grid\s*\{[^}]*--favorite-tile-height/s);
    assert.match(css, /\.favorites-panel\s*\{[^}]*z-index: 40;/s);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/newtabSource.test.js`
Expected: FAIL — the toolbar still has a fixed `width`, the variable is still declared on `.favorites-grid`, and the panel's `z-index` is still `20`.

- [ ] **Step 3: Move `--favorite-tile-height` up and make the toolbar hug its content**

In `src/newtab.css`, change `.favorites-bar` (currently lines 57-74):

```css
.favorites-bar {
  position: fixed;
  z-index: 30;
  top: 16px;
  left: 50%;
  display: flex;
  align-items: center;
  gap: 12px;
  width: fit-content;
  max-width: min(920px, calc(100vw - 32px));
  min-height: var(--toolbar-h);
  padding: 10px 12px;
  transform: translateX(-50%);
  border: 1px solid var(--border);
  border-radius: 20px;
  background: color-mix(in srgb, var(--panel) 82%, transparent);
  box-shadow: 0 18px 48px rgb(0 0 0 / 22%);
  backdrop-filter: blur(20px) saturate(130%);
  --favorite-tile-height: 52px;
}
```

Change `.favorites-grid` (currently lines 76-87) to drop the variable declaration:

```css
.favorites-grid {
  display: flex;
  flex: 1;
  gap: 9px;
  min-width: 0;
  padding-block: 10px;
  margin-block: -10px;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}
```

`--favorite-tile-height` now lives on the common ancestor (`.favorites-bar`) of both `.favorites-grid`'s tiles and the sibling gear button, so both can read it. Declaring it only on `.favorites-grid` (as before) left it invisible to the gear, which is not a descendant of `.favorites-grid`.

- [ ] **Step 4: Raise the settings panel above the toolbar**

Change the `z-index` in `.favorites-panel` (currently line 176, inside the block at lines 174-188) from `20` to `40`:

```css
.favorites-panel {
  position: fixed;
  z-index: 40;
  top: calc(var(--toolbar-h) + 28px);
  ...
```

(only the `z-index` line changes; the rest of the block is unchanged)

- [ ] **Step 5: Update the mobile override to match**

In the `@media (max-width: 600px)` block (currently lines 418-455), change the `.favorites-bar` override (currently lines 423-427):

```css
  .favorites-bar {
    top: 10px;
    max-width: calc(100vw - 20px);
    border-radius: 16px;
  }
```

(`width: calc(100vw - 20px);` becomes `max-width: calc(100vw - 20px);` — the base rule's `width: fit-content` from Step 3 still applies since this override no longer sets `width`)

- [ ] **Step 6: Run the test to verify it passes**

Run: `node --test test/newtabSource.test.js`
Expected: PASS

- [ ] **Step 7: Run the full suite and the syntax check**

Run: `npm test && npm run check`
Expected: all green.

- [ ] **Step 8: Manual check**

Load the unpacked extension. With 1-2 favorites, confirm the toolbar pill is narrow (hugs the tiles + gear, no empty space). Add favorites until the toolbar reaches the viewport-based cap, and confirm horizontal scrolling kicks in inside the tile row beyond that point, with the gear staying visible. Open the settings panel and confirm it visually renders in front of (above) the toolbar, not behind it.

- [ ] **Step 9: Commit**

```bash
git add src/newtab.css test/newtabSource.test.js
git commit -m "fix: make the toolbar hug its content and stack the settings panel above it"
```

---

## Task 6: Tile size rendering, gear sizing, and panel-row icons

**Files:**
- Modify: `src/newtab.js`
- Modify: `src/newtab.css`
- Modify: `test/newtabSource.test.js`

**Interfaces:**
- Consumes: `createIconNode` from `src/icons.js` (Task 2); `item.tileSize` from the favorites schema (Task 1); `--favorite-tile-height` declared on `.favorites-bar` (Task 5).
- Produces: `.favorite-tile[data-tile-size]` dataset attribute driving the CSS width; no new exports.

- [ ] **Step 1: Write the failing tests**

In `test/newtabSource.test.js`, add this test after the one added in Task 5:

```js

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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/newtabSource.test.js`
Expected: FAIL — `newtab.js` doesn't import `icons.js` yet, and the gear/reorder/edit controls still use text glyphs.

- [ ] **Step 3: Import the icon module**

In `src/newtab.js`, add this import after the existing `favoriteIcon.js` import (currently line 7):

```js
import { createIconNode } from "./icons.js";
```

- [ ] **Step 4: Tag each tile with its size**

In `createFavoriteTile` (currently lines 339-358), add one line right after `button.dataset.favoriteId = item.id;`:

```js
function createFavoriteTile(item) {
  const button = createNode("button", "favorite-tile");
  const iconModel = getFavoriteIconModel(item, { faviconBaseUrl });

  button.type = "button";
  button.dataset.favoriteAction = "open";
  button.dataset.favoriteId = item.id;
  button.dataset.tileSize = item.tileSize === "wide" ? "wide" : "square";
  button.title = item.label;
  button.setAttribute("aria-label", `Открыть ${item.label}`);
  button.style.setProperty(
    "--favorite-accent-rgb",
    hexToRgbChannels(normalizeAccentLightness(item.backgroundColor))
  );
  button.appendChild(createFavoriteIconNode(iconModel, item));

  const tileDisabled = favoritesBusy || isFormOpen(favoritesUi);
  button.disabled = tileDisabled;
  button.setAttribute("aria-disabled", String(tileDisabled));
  return button;
}
```

- [ ] **Step 5: Replace the gear's text glyph with an icon**

Change `createFavoritesGear` (currently lines 360-370):

```js
function createFavoritesGear() {
  const gear = createNode("button", "favorite-settings");
  gear.type = "button";
  gear.dataset.favoriteAction = "open-settings";
  gear.setAttribute("aria-label", "Настроить быстрые ссылки");
  gear.setAttribute("aria-expanded", String(isSettingsOpen(favoritesUi)));
  gear.setAttribute("aria-controls", "favorites-panel");
  gear.disabled = favoritesBusy;
  gear.setAttribute("aria-disabled", String(favoritesBusy));
  gear.appendChild(createIconNode("settings", { size: 20 }));
  return gear;
}
```

- [ ] **Step 6: Replace the panel row's reorder/edit glyphs with icons**

In `createFavoritesPanelRow` (currently lines 564-601), change the `left`, `right`, and `edit` button creation:

```js
  const left = createNode("button", "icon-button");
  left.type = "button";
  left.dataset.favoriteAction = "move-left";
  left.dataset.favoriteId = item.id;
  left.setAttribute("aria-label", `Сдвинуть ${item.label} влево`);
  left.disabled = disabled || index === 0;
  left.appendChild(createIconNode("chevronLeft"));

  const right = createNode("button", "icon-button");
  right.type = "button";
  right.dataset.favoriteAction = "move-right";
  right.dataset.favoriteId = item.id;
  right.setAttribute("aria-label", `Сдвинуть ${item.label} вправо`);
  right.disabled = disabled || index === itemCount - 1;
  right.appendChild(createIconNode("chevronRight"));

  const edit = createNode("button", "icon-button");
  edit.type = "button";
  edit.dataset.favoriteAction = "edit";
  edit.dataset.favoriteId = item.id;
  edit.setAttribute("aria-label", `Редактировать ${item.label}`);
  edit.disabled = disabled;
  edit.appendChild(createIconNode("pencil"));
```

(the rest of the function — `controls.append(left, right, edit); row.append(info, controls); return row;` — is unchanged)

- [ ] **Step 7: Give tiles and the gear a fixed, matching box size**

In `src/newtab.css`, change `.favorite-tile` (currently lines 97-120):

```css
.favorite-tile {
  --favorite-accent-rgb: 105, 168, 255;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--favorite-tile-height);
  height: var(--favorite-tile-height);
  padding: 0;
  border: 1px solid rgba(var(--favorite-accent-rgb), 0.78);
  border-radius: 13px;
  background: linear-gradient(
    135deg,
    rgba(var(--favorite-accent-rgb), 0.18),
    rgba(var(--favorite-accent-rgb), 0.06)
  );
  color: var(--text);
  font: inherit;
  cursor: pointer;
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 10%),
    0 1px 4px rgba(var(--favorite-accent-rgb), 0.18);
  transition: transform 160ms ease, border-color 160ms ease, box-shadow 160ms ease;
}

.favorite-tile[data-tile-size="wide"] {
  width: calc(var(--favorite-tile-height) * 2);
}
```

(dropped `gap: 9px;` and `min-width: 52px;`, replaced `padding: 0 14px;` with `padding: 0;`, replaced the implicit content-driven width with an explicit `width`, and added the wide-tile override)

Change `.favorite-settings` (currently lines 157-168):

```css
.favorite-settings {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: var(--favorite-tile-height);
  height: var(--favorite-tile-height);
  border: 1px solid var(--border);
  border-radius: 13px;
  background: var(--panel);
  color: var(--text);
  font: inherit;
  cursor: pointer;
}
```

(was 44×44 with a 12px radius and a 20px `font-size` for the old glyph; now 52×52 with the same 13px radius as a square tile, and the dead `font-size` is dropped since the button now holds an icon node instead of text)

Change `.icon-button` (currently lines 256-265) to center its icon:

```css
.icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
  color: var(--text);
  font: inherit;
  cursor: pointer;
}
```

Add a shared `.icon` rule right after `.icon-button:disabled` (currently lines 267-270):

```css
.icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `node --test test/newtabSource.test.js`
Expected: PASS

- [ ] **Step 9: Run the full suite and the syntax check**

Run: `npm test && npm run check`
Expected: all green.

- [ ] **Step 10: Manual check**

Load the unpacked extension. Confirm the gear button is now the same 52×52 box as a square favorite tile, with a settings-gear SVG icon instead of the old "⚙" glyph. Confirm the settings panel's reorder arrows and edit control show chevron/pencil SVG icons. (Wide tiles aren't reachable yet until Task 7 adds the form control — that's expected at this point.)

- [ ] **Step 11: Commit**

```bash
git add src/newtab.js src/newtab.css test/newtabSource.test.js
git commit -m "feat: render tile size from data and swap toolbar/panel glyphs for icons"
```

---

## Task 7: Unified favorite form (add + edit)

**Files:**
- Modify: `src/newtab.js`
- Modify: `src/newtab.css`
- Modify: `test/newtabSource.test.js`

**Interfaces:**
- Consumes: `createIconNode` (Task 2), `tileSize` field (Task 1).
- Produces: `createFavoriteForm(item)` (item is `null` for add, a favorite object for edit) replacing `createAddForm()`/`createEditForm(item)`. `createSegmentedControl(name, options, selectedValue)`, `createFormRow(labelText, control)`, and `createIconButton(className, text, iconName)` as shared helpers. `readFavoriteFormPayload(data)` builds the service payload shared by both add and edit submits.

- [ ] **Step 1: Write the failing tests**

In `test/newtabSource.test.js`, first replace the existing test that references the old, now-removed add-form `input` variable. Change `"lets favorite URL fields reach service normalization without native URL validation"` (currently lines 40-45) to:

```js
  it("lets favorite URL and custom-icon fields reach service normalization without native URL validation", async () => {
    const code = await source();
    assert.match(code, /\burl\.type = "text";\s+url\.inputMode = "url";/);
    assert.match(code, /customIconUrl\.type = "text";\s+customIconUrl\.inputMode = "url";/);
  });
```

Then add these tests after the one added in Task 6:

```js

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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/newtabSource.test.js`
Expected: FAIL — `createAddForm`/`createEditForm` still exist, `<select>`-based dropdowns are still used, and none of the new helper functions exist yet.

- [ ] **Step 3: Replace `createAddForm`/`createEditForm` with the unified form and its helpers**

In `src/newtab.js`, delete the entire block from `function createAddForm() {` through the closing `}` of `createEditForm` (currently lines 372-490), and replace it with:

```js
function createSegmentedControl(name, options, selectedValue) {
  const group = createNode("div", "segmented");
  group.setAttribute("role", "radiogroup");

  for (const [value, text] of options) {
    const option = createNode("label", "segmented__option");
    const input = document.createElement("input");
    input.type = "radio";
    input.name = name;
    input.value = value;
    input.checked = value === selectedValue;
    option.appendChild(input);
    option.appendChild(createNode("span", null, text));
    group.appendChild(option);
  }

  return group;
}

function createFormRow(labelText, control) {
  const row = createNode("div", "favorite-form__row");
  row.appendChild(createNode("span", "favorite-form__row-label", labelText));
  row.appendChild(control);
  return row;
}

function createIconButton(className, text, iconName) {
  const button = createNode("button", className);
  button.append(createIconNode(iconName), document.createTextNode(text));
  return button;
}

function createFavoriteForm(item) {
  const isEdit = item !== null;
  const form = createNode("form", "favorite-form");
  form.dataset.favoriteForm = isEdit ? "edit" : "add";
  if (isEdit) {
    form.dataset.favoriteId = item.id;
  }

  const url = createNode("input", "favorite-input");
  url.name = "url";
  url.type = "text";
  url.inputMode = "url";
  url.value = isEdit ? item.url : "";
  url.placeholder = "https://example.com";
  url.required = true;
  url.autocomplete = "url";

  const label = createNode("input", "favorite-input");
  label.name = "label";
  label.type = "text";
  label.value = isEdit ? item.label : "";
  label.placeholder = isEdit ? item.domain : "Необязательно";

  const iconMode = createSegmentedControl(
    "iconMode",
    [
      ["favicon", "С сайта"],
      ["letter", "Буква"],
      ["custom", "Своя"]
    ],
    isEdit ? item.iconMode : "favicon"
  );

  const customIconUrl = createNode("input", "favorite-input");
  customIconUrl.name = "customIconUrl";
  customIconUrl.type = "text";
  customIconUrl.inputMode = "url";
  customIconUrl.value = isEdit ? item.customIconUrl ?? "" : "";
  customIconUrl.placeholder = "https://example.com/icon.png";
  const customIconRow = createFormRow("Своя иконка", customIconUrl);
  customIconRow.classList.add("favorite-form__row--custom-icon");

  const backgroundColorSource = createSegmentedControl(
    "backgroundColorSource",
    [
      ["auto", "Авто"],
      ["manual", "Вручную"]
    ],
    isEdit ? item.backgroundColorSource : "auto"
  );

  const color = createNode("input", "favorite-color-input");
  color.name = "backgroundColor";
  color.type = "color";
  color.value = isEdit ? item.backgroundColor : "#24292f";

  const colorControls = createNode("div", "favorite-form__color-controls");
  colorControls.append(backgroundColorSource, color);
  const colorRow = createFormRow("Цвет", colorControls);

  const tileSize = createSegmentedControl(
    "tileSize",
    [
      ["square", "Квадрат"],
      ["wide", "Широкая 2:1"]
    ],
    isEdit ? item.tileSize ?? "square" : "square"
  );

  const footer = createNode("div", "favorite-form__footer");

  if (isEdit) {
    const remove = createIconButton("button button--danger", "Удалить", "trash2");
    remove.type = "button";
    remove.dataset.favoriteAction = "delete";
    remove.dataset.favoriteId = item.id;
    remove.disabled = favoritesBusy;
    footer.appendChild(remove);
  }

  const cancel = createIconButton("button", "Отмена", "x");
  cancel.type = "button";
  cancel.dataset.favoriteAction = "cancel";
  cancel.disabled = favoritesBusy;

  const save = createIconButton(
    "button button--primary",
    isEdit ? "Сохранить" : "Добавить",
    "check"
  );
  save.type = "submit";
  save.disabled = favoritesBusy;

  footer.append(cancel, save);

  form.append(
    createFormRow("Ссылка", url),
    createFormRow("Название", label),
    createFormRow("Иконка", iconMode),
    customIconRow,
    colorRow,
    createFormRow("Размер плашки", tileSize),
    footer
  );

  return form;
}

function readFavoriteFormPayload(data) {
  const backgroundColorSource =
    data.get("backgroundColorSource") === "manual" ? "manual" : "auto";
  const payload = {
    url: data.get("url"),
    label: data.get("label"),
    iconMode: data.get("iconMode"),
    customIconUrl: data.get("customIconUrl"),
    backgroundColorSource,
    tileSize: data.get("tileSize") === "wide" ? "wide" : "square"
  };

  if (backgroundColorSource === "manual") {
    payload.backgroundColor = data.get("backgroundColor");
  }

  return payload;
}
```

Note the color input's `<input type="color">` toggling between inert (auto) and interactive (manual) no longer needs a JS `change` listener — a CSS `:has()` rule added in Step 5 handles it declaratively, driven purely by which radio is checked.

- [ ] **Step 4: Update the two call sites and the two other panel buttons**

In `renderFavoritesPanel` (currently lines 621-680), change the add-button creation:

```js
  const addButton = createIconButton("button button--primary", "Добавить ссылку", "plus");
  addButton.type = "button";
  addButton.dataset.favoriteAction = "start-add";
  addButton.disabled = favoritesBusy || isFormOpen(favoritesUi);
  top.append(heading, addButton);
```

Change the form call sites:

```js
  if (isAdding(favoritesUi)) {
    fragment.appendChild(createFavoriteForm(null));
  }

  const currentEditingId = editingId(favoritesUi);
  const editingItem = items.find((item) => item.id === currentEditingId);
  if (editingItem) {
    fragment.appendChild(createFavoriteForm(editingItem));
  }
```

Change the "Готово" button creation:

```js
  const footer = createNode("div", "favorites-panel__footer");
  const done = createIconButton("button", "Готово", "check");
  done.type = "button";
  done.dataset.favoriteAction = "close-settings";
  footer.appendChild(done);
```

- [ ] **Step 5: Update the submit handler to use the shared payload builder**

In the `favoritesPanelRoot?.addEventListener("submit", ...)` handler (currently lines 872-947), replace the body from `const data = new FormData(form);` through the `try`/`catch` with:

```js
      const data = new FormData(form);

      try {
        if (form.dataset.favoriteForm === "edit") {
          const payload = readFavoriteFormPayload(data);
          favoritesState = await favoritesService.updateFavorite(
            form.dataset.favoriteId,
            payload
          );

          finishFavoritesAction(generation, () => {
            favoritesUi = cancelForm(favoritesUi);
            favoritesError = "";
          });

          if (payload.backgroundColorSource === "auto") {
            void refreshAutoAccent(form.dataset.favoriteId);
          }
          return;
        }

        const payload = readFavoriteFormPayload(data);
        favoritesState = await favoritesService.addFavorite(payload);
        const added = favoritesState.items.at(-1);

        finishFavoritesAction(generation, () => {
          favoritesUi = cancelForm(favoritesUi);
          favoritesError = "";
        });

        if (added) {
          void refreshAutoAccent(added.id);
        }
      } catch (error) {
        finishFavoritesAction(generation, () => {
          favoritesError = error instanceof Error ? error.message : String(error);
        });
      }
```

- [ ] **Step 6: Replace the old form CSS with the row/segmented-control layout**

In `src/newtab.css`, delete `.favorite-form` (currently lines 272-277) and `.favorite-form--editor` (currently lines 302-309), and replace them with:

```css
.favorite-form {
  display: flex;
  flex-direction: column;
  width: min(680px, 100%);
  justify-self: center;
  padding: 4px 12px;
  margin-bottom: 16px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
}

.favorite-form__row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
  border-top: 1px solid var(--border);
}

.favorite-form__row:first-child {
  border-top: none;
}

.favorite-form__row-label {
  flex: 0 0 auto;
  width: 100px;
  font-size: 13px;
  color: var(--muted);
}

.favorite-form__row > .favorite-input,
.favorite-form__row > .segmented {
  flex: 1;
  min-width: 0;
}

.favorite-form__row--custom-icon {
  display: none;
}

.favorite-form:has(input[name="iconMode"][value="custom"]:checked)
  .favorite-form__row--custom-icon {
  display: flex;
}

.favorite-form__color-controls {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.favorite-form__color-controls .segmented {
  flex: 1;
  min-width: 0;
}

.favorite-form__color-controls .favorite-color-input {
  pointer-events: none;
  opacity: 0.5;
}

.favorite-form:has(input[name="backgroundColorSource"][value="manual"]:checked)
  .favorite-form__color-controls
  .favorite-color-input {
  pointer-events: auto;
  opacity: 1;
}

.favorite-form__footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 0;
  border-top: 1px solid var(--border);
}

.favorite-form__footer .button--danger {
  margin-right: auto;
}

.segmented {
  display: flex;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}

.segmented__option {
  position: relative;
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 38px;
  padding: 0 8px;
  border-right: 1px solid var(--border);
  font-size: 13px;
  color: var(--muted);
  cursor: pointer;
  text-align: center;
}

.segmented__option:last-child {
  border-right: none;
}

.segmented__option input {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
}

.segmented__option:has(input:checked) {
  background: var(--primary);
  color: var(--primary-contrast);
  font-weight: 600;
}

.segmented__option:has(input:focus-visible) {
  outline: 3px solid var(--focus);
  outline-offset: -3px;
}
```

- [ ] **Step 7: Give text/icon buttons a centered, icon-friendly layout**

Change `.button` (currently lines 372-383) to add flexbox properties (everything else in the rule is unchanged):

```css
.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 40px;
  padding: 0 14px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel);
  color: var(--text);
  font: inherit;
  font-weight: 600;
  line-height: 1.2;
  cursor: pointer;
}
```

This is a global rule shared with the DTF news card's plain-text buttons ("Просмотрел", "Перейти", etc.) — centering a single text node via flexbox renders identically to the previous default centered text, so those buttons are visually unaffected; only the new icon+text buttons in the favorites panel actually use the added `gap`.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `node --test test/newtabSource.test.js`
Expected: PASS

- [ ] **Step 9: Run the full suite and the syntax check**

Run: `npm test && npm run check`
Expected: all green.

- [ ] **Step 10: Manual check**

Load the unpacked extension and open the settings panel.
- Click "Добавить ссылку": confirm the form shows labeled rows (Ссылка, Название, Иконка, Цвет, Размер плашки) with segmented controls instead of dropdowns, no delete button, and a "Добавить" primary button with a check icon.
- Select "Своя" under Иконка: confirm a "Своя иконка" row appears below it.
- Select "Вручную" under Цвет: confirm the color swatch becomes clickable (it's dimmed/inert under "Авто").
- Select "Широкая 2:1" under Размер плашки, submit, and confirm the resulting tile in the toolbar is twice as wide as a square tile with the same icon centered inside.
- Click a tile's edit (pencil) icon in the panel list: confirm the same layout appears pre-filled, plus a red "Удалить" button with a trash icon, pushed to the left of Отмена/Сохранить.
- Confirm every button in the panel (Добавить ссылку, Сохранить/Добавить, Отмена, Удалить, Готово) shows an icon next to its label.

- [ ] **Step 11: Commit**

```bash
git add src/newtab.js src/newtab.css test/newtabSource.test.js
git commit -m "feat: redesign the favorite form into one labeled, icon-buttoned component"
```

---

## Task 8: Final manual verification pass

**Files:** none (verification only).

- [ ] **Step 1: Run the whole suite one more time**

Run: `npm test && npm run check`
Expected: all green.

- [ ] **Step 2: Load the unpacked extension fresh**

In Chrome, go to `chrome://extensions`, reload the unpacked `dtf-newtab-queue` extension, and open a brand-new tab.

- [ ] **Step 3: Walk the full matrix**

Check each of these on the freshly loaded extension:
- Empty favorites (no tiles yet): toolbar shows just the gear, narrow pill, no empty space.
- Add 1 square and 1 wide favorite: toolbar width grows to fit both, wide tile is visibly 2:1.
- Add favorites until the toolbar's viewport-based width cap is hit: horizontal scroll appears inside the tile row, gear stays visible and reachable.
- Toggle system light/dark theme: accent (buttons, focus rings, gear's expanded border) is black in light mode, white in dark mode; "Удалить" stays red in both.
- Open settings panel: it renders visually above/in front of the toolbar.
- News card: no "DTF" text anywhere, in both a headline-only state and a state with date + queue count.
- Edit an existing favorite, switch icon mode between С сайта/Буква/Своя, and switch color between Авто/Вручную — confirm the conditional rows/enabled states behave correctly and the change persists after closing and reopening the panel.
- Resize the browser to a mobile width (~390px): toolbar still hugs its content and stays within the narrower cap.

- [ ] **Step 4: Report results**

If every item in Step 3 matches expectations, the batch is done. If anything doesn't match, note which specific item and file it traces back to (each behavior above was introduced in a specific task above) before making further changes.
