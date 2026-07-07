# Favorites Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить на страницу новой вкладки верхнюю панель пользовательских избранных ссылок с адаптивными плитками, локальным хранением, редактором, favicon/fallback/custom icon и цветом плитки.

**Architecture:** Favorites реализуются как отдельная подсистема рядом с DTF-очередью: отдельные `favoritesStore`, `favoritesService`, `favoriteIcon`, `favoriteColor` и UI-интеграция в `newtab.js`. Состояние DTF-очереди не меняется; избранное хранится под отдельным ключом `dtfFavorites` в переданном storage area, в первой версии это `chrome.storage.local`.

**Tech Stack:** Vanilla ES modules, DOM API, Node.js built-in test runner (`node --test`), Chromium MV3 extension APIs (`chrome.storage.local`, `_favicon` endpoint). No build step, zero dependencies.

---

## Scope Check

Спецификация описывает один связанный subsystem: favorites bar на new tab. Внутри него есть storage, service, icon/color helpers и UI, но они не требуют отдельных specs. Реализация делится на задачи так, чтобы после каждой задачи был работающий и тестируемый слой.

## Global Constraints

- Node.js 20+.
- Проект использует ES modules и не имеет build step.
- Не добавлять сторонние зависимости.
- Не использовать браузерные bookmarks API.
- Не добавлять options page, service worker, background polling, import/export.
- Не менять ключ `dtfQueueState` и поведение DTF-очереди.
- Рендерить пользовательские данные через `textContent`, `value`, `setAttribute`; не использовать `innerHTML`.
- Ссылки favorites открываются в текущей вкладке через `window.location.assign(url)`.
- Первая версия использует `chrome.storage.local`, но store должен принимать storage area как зависимость.
- При изменениях коммитить после каждой задачи. Stage только перечисленные файлы, не использовать `git add -A`.

## File Structure

| File | Change | Responsibility |
| --- | --- | --- |
| `src/favoritesStore.js` | Create | Валидация persisted state, initial state, bounded items, `getState`/`setState`/`clearState`. |
| `src/favoritesService.js` | Create | CRUD, move left/right, URL normalization, label/domain defaults, storage orchestration. |
| `src/favoriteIcon.js` | Create | Favicon URL construction, icon source selection, letter fallback. |
| `src/favoriteColor.js` | Create | Stable fallback color, dominant color from pixels, contrast helpers, manual override rules. |
| `src/newtab.html` | Modify | Добавить favorites host над DTF app section. |
| `src/newtab.js` | Modify | Подключить favorites service, рендер панели, add/edit/delete/move handlers, open in current tab. |
| `src/newtab.css` | Modify | Layout страницы, adaptive tiles, editor, icon sizing, color swatches. |
| `manifest.json` | Modify | Добавить permission `"favicon"`. |
| `test/favoritesStore.test.js` | Create | Unit-тесты persisted state. |
| `test/favoritesService.test.js` | Create | Unit-тесты CRUD, validation, ordering, manual color. |
| `test/favoriteIcon.test.js` | Create | Unit-тесты `_favicon` URL, custom/letter mode fallbacks. |
| `test/favoriteColor.test.js` | Create | Unit-тесты fallback colors, pixel color selection, contrast text color. |
| `test/manifest.test.js` | Modify | Обновить assertion permissions. |
| `README.md` | Modify | Описать favorites и permission `"favicon"`. |
| `docs/privacy.md` | Modify | Описать локальное хранение favorites и favicon access. |

---

## Task 1: Favorites Store

Создать отдельное локальное хранилище избранного с валидацией и безопасным fallback на пустое состояние при битых данных.

**Files:**
- Create: `src/favoritesStore.js`
- Create: `test/favoritesStore.test.js`

**Public interface after task:**

```js
export const FAVORITES_STORAGE_KEY = "dtfFavorites";
export const MAX_FAVORITES = 200;
export function createInitialFavoritesState(now = new Date().toISOString()) {}
export function isFavoritesState(value) {}
export function createFavoritesStore(storageArea, { now = () => new Date().toISOString() } = {}) {}
```

- [ ] **Step 1: Write failing tests**

Create `test/favoritesStore.test.js`:

```js
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMemoryStorageArea } from "../src/queueStore.js";
import {
  FAVORITES_STORAGE_KEY,
  MAX_FAVORITES,
  createFavoritesStore,
  createInitialFavoritesState,
  isFavoritesState
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

  it("persists, reads, clears, and clones favorites state", async () => {
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
    assert.deepEqual(await storageArea.get(FAVORITES_STORAGE_KEY), {
      [FAVORITES_STORAGE_KEY]: loaded
    });

    loaded.items[0].label = "Mutated after get";
    assert.equal((await store.getState()).items[0].label, "Example");

    await store.clearState();
    assert.deepEqual(await store.getState(), createInitialFavoritesState(NOW));
  });

  it("returns initial state when stored favorites are absent or corrupt", async () => {
    const storageArea = createMemoryStorageArea();
    const store = createFavoritesStore(storageArea, { now: () => NOW });

    assert.deepEqual(await store.getState(), createInitialFavoritesState(NOW));

    await storageArea.set({ [FAVORITES_STORAGE_KEY]: { version: 1, items: "bad" } });
    assert.deepEqual(await store.getState(), createInitialFavoritesState(NOW));
  });
});
```

- [ ] **Step 2: Run the failing test**

Run: `node --test test/favoritesStore.test.js`

Expected: FAIL with a module-not-found error for `../src/favoritesStore.js`.

- [ ] **Step 3: Implement `src/favoritesStore.js`**

Create `src/favoritesStore.js`:

```js
export const FAVORITES_STORAGE_KEY = "dtfFavorites";
export const MAX_FAVORITES = 200;

const ICON_MODES = new Set(["favicon", "letter", "custom"]);
const BACKGROUND_COLOR_SOURCES = new Set(["auto", "manual"]);
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

export function createInitialFavoritesState(now = new Date().toISOString()) {
  return {
    version: 1,
    items: [],
    createdAt: now,
    updatedAt: now
  };
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwnFields(value, fields) {
  return fields.every((field) => Object.hasOwn(value, field));
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isParseableTimestamp(value) {
  return isNonEmptyString(value) && Number.isFinite(Date.parse(value));
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isNullableHttpUrl(value) {
  return value === null || isHttpUrl(value);
}

function isFavoriteItem(value) {
  return (
    isRecord(value) &&
    hasOwnFields(value, [
      "id",
      "url",
      "label",
      "domain",
      "iconMode",
      "customIconUrl",
      "backgroundColor",
      "backgroundColorSource",
      "createdAt",
      "updatedAt"
    ]) &&
    isNonEmptyString(value.id) &&
    isHttpUrl(value.url) &&
    isNonEmptyString(value.label) &&
    isNonEmptyString(value.domain) &&
    ICON_MODES.has(value.iconMode) &&
    isNullableHttpUrl(value.customIconUrl) &&
    typeof value.backgroundColor === "string" &&
    HEX_COLOR_RE.test(value.backgroundColor) &&
    BACKGROUND_COLOR_SOURCES.has(value.backgroundColorSource) &&
    isParseableTimestamp(value.createdAt) &&
    isParseableTimestamp(value.updatedAt)
  );
}

export function isFavoritesState(value) {
  return (
    isRecord(value) &&
    hasOwnFields(value, ["version", "items", "createdAt", "updatedAt"]) &&
    value.version === 1 &&
    Array.isArray(value.items) &&
    value.items.length <= MAX_FAVORITES &&
    value.items.every(isFavoriteItem) &&
    isParseableTimestamp(value.createdAt) &&
    isParseableTimestamp(value.updatedAt)
  );
}

function cloneValue(value) {
  return structuredClone(value);
}

export function createFavoritesStore(
  storageArea,
  { now = () => new Date().toISOString() } = {}
) {
  return {
    async getState() {
      const result = await storageArea.get(FAVORITES_STORAGE_KEY);
      const hasStoredState = Object.hasOwn(result ?? {}, FAVORITES_STORAGE_KEY);

      if (!hasStoredState) {
        return createInitialFavoritesState(now());
      }

      const state = result[FAVORITES_STORAGE_KEY];
      return isFavoritesState(state) ? cloneValue(state) : createInitialFavoritesState(now());
    },

    async setState(state) {
      if (!isFavoritesState(state)) {
        throw new Error("Invalid favorites state");
      }

      await storageArea.set({ [FAVORITES_STORAGE_KEY]: cloneValue(state) });
      return state;
    },

    async clearState() {
      await storageArea.remove(FAVORITES_STORAGE_KEY);
    }
  };
}
```

- [ ] **Step 4: Run tests**

Run: `node --test test/favoritesStore.test.js`

Expected: PASS.

- [ ] **Step 5: Run repository checks**

Run:

```bash
npm run check
npm test
```

Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add src/favoritesStore.js test/favoritesStore.test.js
git commit -m "feat: add favorites store"
```

---

## Task 2: Favorite Service Core

Добавить бизнес-операции избранного: добавить, обновить, удалить, переупорядочить, нормализовать URL и сохранить ручной цвет.

**Files:**
- Create: `src/favoritesService.js`
- Create: `test/favoritesService.test.js`

**Public interface after task:**

```js
export function normalizeFavoriteUrl(input) {}
export function normalizeNullableImageUrl(input) {}
export function createFavoritesService({ store, now, createId, defaultBackgroundColor }) {}
```

- [ ] **Step 1: Write failing tests**

Create `test/favoritesService.test.js`:

```js
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMemoryStorageArea } from "../src/queueStore.js";
import { createFavoritesStore } from "../src/favoritesStore.js";
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
  it("normalizes user-entered URLs", () => {
    assert.deepEqual(normalizeFavoriteUrl("example.com/path"), {
      url: "https://example.com/path",
      domain: "example.com"
    });
    assert.deepEqual(normalizeFavoriteUrl(" http://localhost:3000/a "), {
      url: "http://localhost:3000/a",
      domain: "localhost"
    });

    assert.throws(() => normalizeFavoriteUrl(""), /Enter a URL/);
    assert.throws(() => normalizeFavoriteUrl("javascript:alert(1)"), /Only http and https URLs are supported/);
    assert.throws(() => normalizeFavoriteUrl("file:///tmp/a.html"), /Only http and https URLs are supported/);
  });

  it("normalizes optional custom image URLs", () => {
    assert.equal(normalizeNullableImageUrl(""), null);
    assert.equal(normalizeNullableImageUrl("   "), null);
    assert.equal(normalizeNullableImageUrl(null), null);
    assert.equal(normalizeNullableImageUrl("cdn.example.com/icon.png"), "https://cdn.example.com/icon.png");
    assert.equal(normalizeNullableImageUrl("https://cdn.example.com/icon.png"), "https://cdn.example.com/icon.png");
    assert.throws(() => normalizeNullableImageUrl("data:image/svg+xml,abc"), /Only http and https image URLs are supported/);
  });

  it("adds a favorite with defaults from the URL", async () => {
    const { service, store } = await createHarness();

    const result = await service.addFavorite({
      url: "example.com/app",
      label: "",
      iconMode: "favicon",
      customIconUrl: "",
      backgroundColor: "",
      backgroundColorSource: "auto"
    });

    assert.equal(result.items.length, 1);
    assert.deepEqual(result.items[0], {
      id: "fav-1",
      url: "https://example.com/app",
      label: "example.com",
      domain: "example.com",
      iconMode: "favicon",
      customIconUrl: null,
      backgroundColor: "#24292f",
      backgroundColorSource: "auto",
      createdAt: NOW,
      updatedAt: NOW
    });
    assert.deepEqual(await store.getState(), result);
  });

  it("updates URL, label, icon mode, custom image, and manual color", async () => {
    const { service } = await createHarness();
    const created = await service.addFavorite({ url: "example.com" });
    const id = created.items[0].id;

    const updated = await service.updateFavorite(id, {
      url: "https://news.example.com/feed",
      label: "News",
      iconMode: "custom",
      customIconUrl: "images.example.com/icon.png",
      backgroundColor: "#123abc",
      backgroundColorSource: "manual"
    });

    assert.deepEqual(updated.items[0], {
      id,
      url: "https://news.example.com/feed",
      label: "News",
      domain: "news.example.com",
      iconMode: "custom",
      customIconUrl: "https://images.example.com/icon.png",
      backgroundColor: "#123abc",
      backgroundColorSource: "manual",
      createdAt: NOW,
      updatedAt: NOW
    });
  });

  it("keeps previous manual color when update omits color fields", async () => {
    const { service } = await createHarness();
    const created = await service.addFavorite({
      url: "example.com",
      backgroundColor: "#112233",
      backgroundColorSource: "manual"
    });
    const id = created.items[0].id;

    const updated = await service.updateFavorite(id, {
      label: "Renamed"
    });

    assert.equal(updated.items[0].label, "Renamed");
    assert.equal(updated.items[0].backgroundColor, "#112233");
    assert.equal(updated.items[0].backgroundColorSource, "manual");
  });

  it("deletes and moves favorites", async () => {
    const { service } = await createHarness();

    await service.addFavorite({ url: "a.example.com" });
    await service.addFavorite({ url: "b.example.com" });
    let state = await service.addFavorite({ url: "c.example.com" });

    assert.deepEqual(state.items.map((item) => item.domain), [
      "a.example.com",
      "b.example.com",
      "c.example.com"
    ]);

    state = await service.moveFavorite(state.items[2].id, -1);
    assert.deepEqual(state.items.map((item) => item.domain), [
      "a.example.com",
      "c.example.com",
      "b.example.com"
    ]);

    state = await service.moveFavorite(state.items[0].id, -1);
    assert.deepEqual(state.items.map((item) => item.domain), [
      "a.example.com",
      "c.example.com",
      "b.example.com"
    ]);

    state = await service.deleteFavorite(state.items[1].id);
    assert.deepEqual(state.items.map((item) => item.domain), [
      "a.example.com",
      "b.example.com"
    ]);
  });

  it("throws for unknown favorites and invalid colors", async () => {
    const { service } = await createHarness();

    await assert.rejects(() => service.updateFavorite("missing", { label: "x" }), /Favorite not found/);
    await assert.rejects(() => service.deleteFavorite("missing"), /Favorite not found/);
    await assert.rejects(() => service.moveFavorite("missing", 1), /Favorite not found/);
    await assert.rejects(
      () => service.addFavorite({ url: "example.com", backgroundColor: "red" }),
      /Use a hex color/
    );
  });
});
```

- [ ] **Step 2: Run failing tests**

Run: `node --test test/favoritesService.test.js`

Expected: FAIL with a module-not-found error for `../src/favoritesService.js`.

- [ ] **Step 3: Implement `src/favoritesService.js`**

Create `src/favoritesService.js`:

```js
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;
const ICON_MODES = new Set(["favicon", "letter", "custom"]);
const BACKGROUND_COLOR_SOURCES = new Set(["auto", "manual"]);

function trimString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function ensureUrlProtocol(input) {
  const trimmed = trimString(input);

  if (!trimmed) {
    throw new Error("Enter a URL");
  }

  return /^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function normalizeFavoriteUrl(input) {
  let parsed;

  try {
    parsed = new URL(ensureUrlProtocol(input));
  } catch {
    throw new Error("Enter a valid URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http and https URLs are supported");
  }

  return {
    url: parsed.href,
    domain: parsed.hostname
  };
}

export function normalizeNullableImageUrl(input) {
  if (input === null || input === undefined || trimString(input) === "") {
    return null;
  }

  let parsed;

  try {
    parsed = new URL(ensureUrlProtocol(input));
  } catch {
    throw new Error("Enter a valid image URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http and https image URLs are supported");
  }

  return parsed.href;
}

function normalizeLabel(label, domain) {
  const trimmed = trimString(label);
  return trimmed || domain;
}

function normalizeIconMode(iconMode = "favicon") {
  if (!ICON_MODES.has(iconMode)) {
    throw new Error("Choose a supported icon mode");
  }

  return iconMode;
}

function normalizeBackgroundColor(color, fallbackColor) {
  const trimmed = trimString(color);

  if (!trimmed) {
    return fallbackColor;
  }

  if (!HEX_COLOR_RE.test(trimmed)) {
    throw new Error("Use a hex color like #24292f");
  }

  return trimmed.toLowerCase();
}

function normalizeBackgroundColorSource(source = "auto") {
  if (!BACKGROUND_COLOR_SOURCES.has(source)) {
    throw new Error("Choose a supported background color source");
  }

  return source;
}

function replaceItem(items, id, updater) {
  const index = items.findIndex((item) => item.id === id);

  if (index === -1) {
    throw new Error("Favorite not found");
  }

  return items.map((item, itemIndex) => (itemIndex === index ? updater(item) : item));
}

export function createFavoritesService({
  store,
  now = () => new Date().toISOString(),
  createId = () => crypto.randomUUID(),
  defaultBackgroundColor = () => "#24292f"
}) {
  async function saveItems(previousState, items) {
    const timestamp = now();
    const nextState = {
      ...previousState,
      items,
      updatedAt: timestamp
    };

    await store.setState(nextState);
    return nextState;
  }

  return {
    async getState() {
      return store.getState();
    },

    async addFavorite(input) {
      const state = await store.getState();
      const timestamp = now();
      const normalizedUrl = normalizeFavoriteUrl(input.url);
      const iconMode = normalizeIconMode(input.iconMode ?? "favicon");
      const backgroundColorSource = normalizeBackgroundColorSource(
        input.backgroundColorSource ?? (input.backgroundColor ? "manual" : "auto")
      );
      const backgroundColor = normalizeBackgroundColor(
        input.backgroundColor,
        defaultBackgroundColor(normalizedUrl.domain)
      );

      const item = {
        id: createId(),
        url: normalizedUrl.url,
        label: normalizeLabel(input.label, normalizedUrl.domain),
        domain: normalizedUrl.domain,
        iconMode,
        customIconUrl: normalizeNullableImageUrl(input.customIconUrl),
        backgroundColor,
        backgroundColorSource,
        createdAt: timestamp,
        updatedAt: timestamp
      };

      return saveItems(state, [...state.items, item]);
    },

    async updateFavorite(id, input) {
      const state = await store.getState();
      const timestamp = now();
      const items = replaceItem(state.items, id, (existing) => {
        const normalizedUrl =
          input.url === undefined
            ? { url: existing.url, domain: existing.domain }
            : normalizeFavoriteUrl(input.url);
        const backgroundColorSource =
          input.backgroundColorSource === undefined
            ? existing.backgroundColorSource
            : normalizeBackgroundColorSource(input.backgroundColorSource);
        const backgroundColor =
          input.backgroundColor === undefined
            ? existing.backgroundColor
            : normalizeBackgroundColor(input.backgroundColor, existing.backgroundColor);

        return {
          ...existing,
          url: normalizedUrl.url,
          label:
            input.label === undefined
              ? existing.label
              : normalizeLabel(input.label, normalizedUrl.domain),
          domain: normalizedUrl.domain,
          iconMode:
            input.iconMode === undefined
              ? existing.iconMode
              : normalizeIconMode(input.iconMode),
          customIconUrl:
            input.customIconUrl === undefined
              ? existing.customIconUrl
              : normalizeNullableImageUrl(input.customIconUrl),
          backgroundColor,
          backgroundColorSource,
          updatedAt: timestamp
        };
      });

      return saveItems(state, items);
    },

    async deleteFavorite(id) {
      const state = await store.getState();
      const nextItems = state.items.filter((item) => item.id !== id);

      if (nextItems.length === state.items.length) {
        throw new Error("Favorite not found");
      }

      return saveItems(state, nextItems);
    },

    async moveFavorite(id, direction) {
      const state = await store.getState();
      const index = state.items.findIndex((item) => item.id === id);

      if (index === -1) {
        throw new Error("Favorite not found");
      }

      const nextIndex = Math.max(0, Math.min(state.items.length - 1, index + direction));

      if (nextIndex === index) {
        return state;
      }

      const items = [...state.items];
      const [item] = items.splice(index, 1);
      items.splice(nextIndex, 0, item);
      return saveItems(state, items);
    }
  };
}
```

- [ ] **Step 4: Run tests**

Run: `node --test test/favoritesService.test.js`

Expected: PASS.

- [ ] **Step 5: Run repository checks**

Run:

```bash
npm run check
npm test
```

Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add src/favoritesService.js test/favoritesService.test.js
git commit -m "feat: add favorites service"
```

---

## Task 3: Icon and Color Helpers

Добавить helper-функции для favicon URL, режима иконки, fallback-буквы, fallback-цвета и выбора dominant color из пикселей.

**Files:**
- Create: `src/favoriteIcon.js`
- Create: `src/favoriteColor.js`
- Create: `test/favoriteIcon.test.js`
- Create: `test/favoriteColor.test.js`

**Public interface after task:**

```js
export function getFaviconUrl({ extensionId, pageUrl, size = 64 }) {}
export function getFavoriteIconModel(item, { extensionId }) {}
export function getFavoriteLetter(item) {}
export function fallbackColorForDomain(domain) {}
export function pickDominantColorFromPixels(pixels) {}
export function readableTextColor(backgroundColor) {}
export async function extractImageBackgroundColor(imageUrl, { loadImage, createCanvas }) {}
```

- [ ] **Step 1: Write failing icon tests**

Create `test/favoriteIcon.test.js`:

```js
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getFaviconUrl,
  getFavoriteIconModel,
  getFavoriteLetter
} from "../src/favoriteIcon.js";

const item = {
  id: "fav-1",
  url: "https://example.com/path?q=1",
  label: "Example",
  domain: "example.com",
  iconMode: "favicon",
  customIconUrl: null,
  backgroundColor: "#24292f",
  backgroundColorSource: "auto",
  createdAt: "2026-07-07T10:00:00.000Z",
  updatedAt: "2026-07-07T10:00:00.000Z"
};

describe("favoriteIcon", () => {
  it("builds the Chrome MV3 favicon endpoint URL", () => {
    assert.equal(
      getFaviconUrl({
        extensionId: "abc123",
        pageUrl: "https://example.com/path?q=1",
        size: 64
      }),
      "chrome-extension://abc123/_favicon/?pageUrl=https%3A%2F%2Fexample.com%2Fpath%3Fq%3D1&size=64"
    );
  });

  it("returns custom icon model when custom mode has a URL", () => {
    assert.deepEqual(
      getFavoriteIconModel(
        {
          ...item,
          iconMode: "custom",
          customIconUrl: "https://cdn.example.com/icon.png"
        },
        { extensionId: "abc123" }
      ),
      {
        type: "image",
        src: "https://cdn.example.com/icon.png",
        alt: "Example"
      }
    );
  });

  it("returns favicon icon model in favicon mode", () => {
    assert.deepEqual(getFavoriteIconModel(item, { extensionId: "abc123" }), {
      type: "image",
      src: "chrome-extension://abc123/_favicon/?pageUrl=https%3A%2F%2Fexample.com%2Fpath%3Fq%3D1&size=64",
      alt: "Example"
    });
  });

  it("falls back to a letter for letter mode or missing extension id", () => {
    assert.deepEqual(getFavoriteIconModel({ ...item, iconMode: "letter" }, { extensionId: "abc123" }), {
      type: "letter",
      letter: "E",
      alt: "Example"
    });
    assert.deepEqual(getFavoriteIconModel(item, { extensionId: "" }), {
      type: "letter",
      letter: "E",
      alt: "Example"
    });
  });

  it("uses the first domain letter when label is empty-like", () => {
    assert.equal(getFavoriteLetter({ ...item, label: " ", domain: "dtf.ru" }), "D");
  });
});
```

- [ ] **Step 2: Write failing color tests**

Create `test/favoriteColor.test.js`:

```js
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  fallbackColorForDomain,
  pickDominantColorFromPixels,
  readableTextColor
} from "../src/favoriteColor.js";

describe("favoriteColor", () => {
  it("returns stable hex fallback colors by domain", () => {
    assert.match(fallbackColorForDomain("example.com"), /^#[0-9a-f]{6}$/);
    assert.equal(fallbackColorForDomain("example.com"), fallbackColorForDomain("example.com"));
    assert.notEqual(fallbackColorForDomain("example.com"), fallbackColorForDomain("dtf.ru"));
  });

  it("picks a dominant visible color from RGBA pixels", () => {
    const pixels = [
      255, 255, 255, 255,
      250, 250, 250, 255,
      36, 41, 47, 255,
      36, 41, 47, 255,
      36, 41, 47, 255,
      10, 10, 10, 0
    ];

    assert.equal(pickDominantColorFromPixels(pixels), "#24292f");
  });

  it("falls back when pixels are transparent or near-white only", () => {
    assert.equal(
      pickDominantColorFromPixels([
        255, 255, 255, 255,
        240, 240, 240, 255,
        10, 20, 30, 0
      ]),
      null
    );
  });

  it("returns readable text colors", () => {
    assert.equal(readableTextColor("#111318"), "#ffffff");
    assert.equal(readableTextColor("#f3f5f7"), "#111318");
  });
});
```

- [ ] **Step 3: Run failing tests**

Run: `node --test test/favoriteIcon.test.js test/favoriteColor.test.js`

Expected: FAIL with module-not-found errors for `favoriteIcon.js` and `favoriteColor.js`.

- [ ] **Step 4: Implement `src/favoriteIcon.js`**

Create `src/favoriteIcon.js`:

```js
export function getFaviconUrl({ extensionId, pageUrl, size = 64 }) {
  const params = new URLSearchParams({
    pageUrl,
    size: String(size)
  });

  return `chrome-extension://${extensionId}/_favicon/?${params.toString()}`;
}

export function getFavoriteLetter(item) {
  const source = item.label?.trim() || item.domain?.trim() || "?";
  return source.slice(0, 1).toLocaleUpperCase("ru-RU");
}

export function getFavoriteIconModel(item, { extensionId }) {
  const alt = item.label || item.domain;

  if (item.iconMode === "custom" && item.customIconUrl) {
    return {
      type: "image",
      src: item.customIconUrl,
      alt
    };
  }

  if (item.iconMode === "favicon" && extensionId) {
    return {
      type: "image",
      src: getFaviconUrl({
        extensionId,
        pageUrl: item.url,
        size: 64
      }),
      alt
    };
  }

  return {
    type: "letter",
    letter: getFavoriteLetter(item),
    alt
  };
}
```

- [ ] **Step 5: Implement `src/favoriteColor.js`**

Create `src/favoriteColor.js`:

```js
const FALLBACK_COLORS = [
  "#24292f",
  "#0969da",
  "#1a7f64",
  "#9a6700",
  "#bc4c00",
  "#8250df",
  "#bf3989",
  "#cf222e"
];

function hexByte(value) {
  return value.toString(16).padStart(2, "0");
}

function toHexColor([red, green, blue]) {
  return `#${hexByte(red)}${hexByte(green)}${hexByte(blue)}`;
}

function parseHexColor(color) {
  return [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16)
  ];
}

function luminance([red, green, blue]) {
  const [r, g, b] = [red, green, blue].map((channel) => {
    const value = channel / 255;
    return value <= 0.03928
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function isNearWhite(red, green, blue) {
  return red > 232 && green > 232 && blue > 232;
}

function quantize(red, green, blue) {
  return [red, green, blue].map((channel) => Math.round(channel / 8) * 8);
}

export function fallbackColorForDomain(domain) {
  const normalized = String(domain || "").toLowerCase();
  let hash = 0;

  for (const char of normalized) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }

  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length];
}

export function pickDominantColorFromPixels(pixels) {
  const buckets = new Map();

  for (let index = 0; index < pixels.length; index += 4) {
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    const alpha = pixels[index + 3];

    if (alpha < 128 || isNearWhite(red, green, blue)) {
      continue;
    }

    const key = toHexColor(quantize(red, green, blue));
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }

  let best = null;
  let bestCount = 0;

  for (const [color, count] of buckets) {
    if (count > bestCount) {
      best = color;
      bestCount = count;
    }
  }

  return best;
}

export function readableTextColor(backgroundColor) {
  return luminance(parseHexColor(backgroundColor)) > 0.55 ? "#111318" : "#ffffff";
}

export async function extractImageBackgroundColor(
  imageUrl,
  { loadImage, createCanvas, sampleSize = 32 }
) {
  try {
    const image = await loadImage(imageUrl);
    const canvas = createCanvas(sampleSize, sampleSize);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0, sampleSize, sampleSize);
    const imageData = context.getImageData(0, 0, sampleSize, sampleSize);
    return pickDominantColorFromPixels(imageData.data);
  } catch {
    return null;
  }
}
```

- [ ] **Step 6: Run helper tests**

Run: `node --test test/favoriteIcon.test.js test/favoriteColor.test.js`

Expected: PASS.

- [ ] **Step 7: Run repository checks**

Run:

```bash
npm run check
npm test
```

Expected: both PASS.

- [ ] **Step 8: Commit**

```bash
git add src/favoriteIcon.js src/favoriteColor.js test/favoriteIcon.test.js test/favoriteColor.test.js
git commit -m "feat: add favorite icon and color helpers"
```

---

## Task 4: Manifest Favicon Permission

Добавить permission `"favicon"` и обновить manifest test.

**Files:**
- Modify: `manifest.json`
- Modify: `test/manifest.test.js`

- [ ] **Step 1: Write failing manifest assertion**

Modify `test/manifest.test.js`:

```js
describe("manifest", () => {
  it("uses only the required storage, favicon, and DTF API privileges", async () => {
    const manifest = await readManifest();

    assert.deepEqual(manifest.permissions, ["storage", "favicon"]);
    assert.deepEqual(manifest.host_permissions, ["https://api.dtf.ru/*"]);
  });
});
```

- [ ] **Step 2: Run failing manifest test**

Run: `node --test test/manifest.test.js`

Expected: FAIL because `manifest.permissions` is currently `["storage"]`.

- [ ] **Step 3: Update `manifest.json`**

Change permissions:

```json
"permissions": ["storage", "favicon"],
```

- [ ] **Step 4: Run tests**

Run:

```bash
node --test test/manifest.test.js
npm test
```

Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add manifest.json test/manifest.test.js
git commit -m "feat: request favicon permission"
```

---

## Task 5: Favorites UI Shell and Add/Open Flow

Интегрировать favorites bar в new tab: host над DTF-карточкой, пустое состояние с `+`, добавление ссылки, render плиток, открытие в текущей вкладке.

**Files:**
- Modify: `src/newtab.html`
- Modify: `src/newtab.js`
- Modify: `src/newtab.css`

**UI state added in `newtab.js`:**

```js
let favoritesState = null;
let favoritesEditingId = null;
let favoritesMode = "view";
let favoritesError = "";
```

- [ ] **Step 1: Add the HTML host**

Modify `src/newtab.html` so body contains a dedicated favorites host above `#app`:

```html
  <body>
    <main class="page" aria-live="polite" aria-atomic="true">
      <section class="favorites-bar" id="favorites" aria-label="Избранные ссылки"></section>
      <section class="panel" id="app">
        <p class="eyebrow">DTF</p>
        <h1 class="title">Загружаю новость...</h1>
      </section>
    </main>
    <script type="module" src="./newtab.js"></script>
  </body>
```

- [ ] **Step 2: Import favorites modules in `src/newtab.js`**

Add imports near the top:

```js
import { fallbackColorForDomain, readableTextColor } from "./favoriteColor.js";
import { getFavoriteIconModel } from "./favoriteIcon.js";
import { createFavoritesService } from "./favoritesService.js";
import { createFavoritesStore } from "./favoritesStore.js";
```

Add DOM reference:

```js
const favoritesRoot = document.querySelector("#favorites");
```

- [ ] **Step 3: Create a favorites service instance**

After `const storageArea = chromeApi?.storage?.local;`, add:

```js
const extensionId = chromeApi?.runtime?.id ?? "";

const favoritesService =
  storageArea &&
  typeof storageArea.get === "function" &&
  typeof storageArea.set === "function"
    ? createFavoritesService({
        store: createFavoritesStore(storageArea),
        defaultBackgroundColor: fallbackColorForDomain
      })
    : null;
```

- [ ] **Step 4: Add rendering helpers**

Add these helpers above queue initialization:

```js
let favoritesState = null;
let favoritesMode = "view";
let favoritesEditingId = null;
let favoritesError = "";

function createIconNode(model) {
  if (model.type === "image") {
    const image = createNode("img", "favorite-icon");
    image.src = model.src;
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
    image.addEventListener("error", () => {
      const fallback = createNode("span", "favorite-letter", model.alt.slice(0, 1).toLocaleUpperCase("ru-RU"));
      image.replaceWith(fallback);
    });
    return image;
  }

  return createNode("span", "favorite-letter", model.letter);
}

function createFavoriteTile(item) {
  const button = createNode("button", "favorite-tile");
  const iconModel = getFavoriteIconModel(item, { extensionId });

  button.type = "button";
  button.dataset.favoriteAction = "open";
  button.dataset.favoriteId = item.id;
  button.title = item.label;
  button.setAttribute("aria-label", `Открыть ${item.label}`);
  button.style.setProperty("--favorite-bg", item.backgroundColor);
  button.style.setProperty("--favorite-fg", readableTextColor(item.backgroundColor));
  button.appendChild(createIconNode(iconModel));
  return button;
}

function createFavoriteAddButton() {
  const button = createNode("button", "favorite-tile favorite-tile--add", "+");
  button.type = "button";
  button.dataset.favoriteAction = "start-add";
  button.setAttribute("aria-label", "Добавить избранную ссылку");
  return button;
}

function createFavoritesActions() {
  const actions = createNode("div", "favorites-actions");
  const settings = createNode("button", "favorite-settings", "⚙");
  settings.type = "button";
  settings.dataset.favoriteAction = "toggle-edit";
  settings.setAttribute("aria-label", "Настройки избранных ссылок");
  actions.appendChild(settings);
  return actions;
}

function createAddForm() {
  const form = createNode("form", "favorite-form");
  form.dataset.favoriteForm = "add";

  const input = createNode("input", "favorite-input");
  input.name = "url";
  input.type = "url";
  input.placeholder = "https://example.com";
  input.required = true;
  input.autocomplete = "url";

  const save = createNode("button", "button button--primary", "Сохранить");
  save.type = "submit";

  const cancel = createNode("button", "button", "Отмена");
  cancel.type = "button";
  cancel.dataset.favoriteAction = "cancel";

  form.append(input, save, cancel);
  return form;
}

function renderFavorites() {
  if (!favoritesRoot) {
    return;
  }

  const fragment = document.createDocumentFragment();
  const grid = createNode("div", "favorites-grid");

  for (const item of favoritesState?.items ?? []) {
    grid.appendChild(createFavoriteTile(item));
  }

  grid.appendChild(createFavoriteAddButton());
  fragment.appendChild(grid);
  fragment.appendChild(createFavoritesActions());

  if (favoritesMode === "add") {
    fragment.appendChild(createAddForm());
  }

  if (favoritesError) {
    fragment.appendChild(createStatus(favoritesError, { error: true, live: "assertive" }));
  }

  favoritesRoot.replaceChildren(fragment);
}
```

- [ ] **Step 5: Load favorites on startup**

Inside `if (app) { ... }`, before queue `service.initialize()`, add:

```js
  void (async () => {
    if (!favoritesService) {
      favoritesError = "Недоступны API Chrome для избранного.";
      renderFavorites();
      return;
    }

    try {
      favoritesState = await favoritesService.getState();
      renderFavorites();
    } catch (error) {
      favoritesError = error instanceof Error ? error.message : String(error);
      renderFavorites();
    }
  })();
```

- [ ] **Step 6: Wire add/open/cancel handlers**

Add a delegated listener after the existing `app.addEventListener` block:

```js
  favoritesRoot?.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }

    const target = event.target.closest("[data-favorite-action]");

    if (!(target instanceof HTMLElement)) {
      return;
    }

    const action = target.dataset.favoriteAction;

    if (action === "start-add") {
      favoritesMode = "add";
      favoritesError = "";
      renderFavorites();
    } else if (action === "cancel") {
      favoritesMode = "view";
      favoritesEditingId = null;
      favoritesError = "";
      renderFavorites();
    } else if (action === "open") {
      const favorite = favoritesState?.items.find((item) => item.id === target.dataset.favoriteId);

      if (favorite) {
        window.location.assign(favorite.url);
      }
    }
  });

  favoritesRoot?.addEventListener("submit", (event) => {
    const form = event.target;

    if (!(form instanceof HTMLFormElement) || form.dataset.favoriteForm !== "add") {
      return;
    }

    event.preventDefault();

    void (async () => {
      const data = new FormData(form);

      try {
        favoritesState = await favoritesService.addFavorite({
          url: data.get("url")
        });
        favoritesMode = "view";
        favoritesError = "";
        renderFavorites();
      } catch (error) {
        favoritesError = error instanceof Error ? error.message : String(error);
        renderFavorites();
      }
    })();
  });
```

- [ ] **Step 7: Add minimum CSS for shell**

Append to `src/newtab.css`:

```css
.page {
  align-content: center;
  gap: 18px;
}

.favorites-bar {
  width: min(920px, 100%);
  display: grid;
  gap: 10px;
}

.favorites-grid {
  --favorite-tile-height: 56px;
  display: grid;
  grid-template-columns: repeat(
    auto-fit,
    minmax(var(--favorite-tile-height), calc(var(--favorite-tile-height) * 2))
  );
  gap: 10px;
  justify-content: center;
}

.favorite-tile {
  min-width: var(--favorite-tile-height);
  max-width: calc(var(--favorite-tile-height) * 2);
  width: 100%;
  height: var(--favorite-tile-height);
  display: grid;
  place-items: center;
  padding: 10px;
  border: 1px solid rgb(0 0 0 / 14%);
  border-radius: 12px;
  background: var(--favorite-bg, var(--panel));
  color: var(--favorite-fg, var(--text));
  cursor: pointer;
}

.favorite-icon,
.favorite-letter {
  width: 30px;
  height: 30px;
}

.favorite-icon {
  object-fit: contain;
}

.favorite-letter {
  display: grid;
  place-items: center;
  font-size: 18px;
  font-weight: 800;
}

.favorite-tile--add {
  border-style: dashed;
  border-color: var(--primary);
  background: var(--panel);
  color: var(--primary);
  font-size: 28px;
  line-height: 1;
}

.favorites-actions {
  display: flex;
  justify-content: center;
}

.favorite-settings {
  width: 36px;
  height: 36px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
  color: var(--text);
  cursor: pointer;
}

.favorite-form {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: center;
}

.favorite-input {
  min-height: 40px;
  min-width: min(320px, 100%);
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel);
  color: var(--text);
  font: inherit;
}
```

- [ ] **Step 8: Run syntax checks and tests**

Run:

```bash
npm run check
npm test
```

Expected: both PASS.

- [ ] **Step 9: Manual browser verification**

Load unpacked extension in Chromium, open a new tab, and verify:

- Empty favorites panel shows a `+` tile.
- Clicking `+` shows URL form.
- Saving `example.com` adds a tile.
- Clicking that tile navigates the current tab to `https://example.com/`.
- DTF card still renders below the favorites panel.

- [ ] **Step 10: Commit**

```bash
git add src/newtab.html src/newtab.js src/newtab.css
git commit -m "feat: add favorites bar add and open flow"
```

---

## Task 6: Full Editor Controls

Добавить режим редактирования через шестерёнку: URL, label, icon mode, custom image URL, manual color, delete, move left/right.

**Files:**
- Modify: `src/newtab.js`
- Modify: `src/newtab.css`

- [ ] **Step 1: Add edit controls renderer**

In `src/newtab.js`, add this helper after `createAddForm()`:

```js
function createEditForm(item) {
  const form = createNode("form", "favorite-form favorite-form--editor");
  form.dataset.favoriteForm = "edit";
  form.dataset.favoriteId = item.id;

  const url = createNode("input", "favorite-input");
  url.name = "url";
  url.type = "url";
  url.value = item.url;
  url.required = true;
  url.autocomplete = "url";

  const label = createNode("input", "favorite-input");
  label.name = "label";
  label.type = "text";
  label.value = item.label;
  label.placeholder = item.domain;

  const iconMode = createNode("select", "favorite-input");
  iconMode.name = "iconMode";

  for (const [value, text] of [
    ["favicon", "С сайта"],
    ["letter", "Буква"],
    ["custom", "Своя"]
  ]) {
    const option = createNode("option", "", text);
    option.value = value;
    option.selected = value === item.iconMode;
    iconMode.appendChild(option);
  }

  const customIconUrl = createNode("input", "favorite-input");
  customIconUrl.name = "customIconUrl";
  customIconUrl.type = "url";
  customIconUrl.value = item.customIconUrl ?? "";
  customIconUrl.placeholder = "https://example.com/icon.png";

  const color = createNode("input", "favorite-color-input");
  color.name = "backgroundColor";
  color.type = "color";
  color.value = item.backgroundColor;

  const backgroundColorSource = createNode("select", "favorite-input");
  backgroundColorSource.name = "backgroundColorSource";

  for (const [value, text] of [
    ["auto", "Автоцвет"],
    ["manual", "Ручной цвет"]
  ]) {
    const option = createNode("option", "", text);
    option.value = value;
    option.selected = value === item.backgroundColorSource;
    backgroundColorSource.appendChild(option);
  }

  const save = createNode("button", "button button--primary", "Сохранить");
  save.type = "submit";

  const cancel = createNode("button", "button", "Отмена");
  cancel.type = "button";
  cancel.dataset.favoriteAction = "cancel";

  const remove = createNode("button", "button button--danger", "Удалить");
  remove.type = "button";
  remove.dataset.favoriteAction = "delete";
  remove.dataset.favoriteId = item.id;

  form.append(
    url,
    label,
    iconMode,
    customIconUrl,
    backgroundColorSource,
    color,
    save,
    cancel,
    remove
  );
  return form;
}
```

- [ ] **Step 2: Render edit mode actions on tiles**

Modify `createFavoriteTile(item)`:

```js
function createFavoriteTile(item) {
  const button = createNode("button", "favorite-tile");
  const iconModel = getFavoriteIconModel(item, { extensionId });

  button.type = "button";
  button.dataset.favoriteAction = favoritesMode === "edit" ? "edit" : "open";
  button.dataset.favoriteId = item.id;
  button.title = item.label;
  button.setAttribute(
    "aria-label",
    favoritesMode === "edit" ? `Редактировать ${item.label}` : `Открыть ${item.label}`
  );
  button.style.setProperty("--favorite-bg", item.backgroundColor);
  button.style.setProperty("--favorite-fg", readableTextColor(item.backgroundColor));
  button.appendChild(createIconNode(iconModel));
  return button;
}
```

Modify `renderFavorites()` to add move controls in edit mode and show the edit form:

```js
  const items = favoritesState?.items ?? [];

  items.forEach((item, index) => {
    const wrapper = createNode("div", "favorite-tile-wrap");
    wrapper.appendChild(createFavoriteTile(item));

    if (favoritesMode === "edit") {
      const moveRow = createNode("div", "favorite-move-row");
      const left = createNode("button", "favorite-mini-button", "‹");
      const right = createNode("button", "favorite-mini-button", "›");
      left.type = "button";
      right.type = "button";
      left.dataset.favoriteAction = "move-left";
      right.dataset.favoriteAction = "move-right";
      left.dataset.favoriteId = item.id;
      right.dataset.favoriteId = item.id;
      left.disabled = index === 0;
      right.disabled = index === items.length - 1;
      moveRow.append(left, right);
      wrapper.appendChild(moveRow);
    }

    grid.appendChild(wrapper);
  });
```

Replace the old `for (const item of favoritesState?.items ?? []) { ... }` loop with this block.

After add form rendering in `renderFavorites()`, add:

```js
  const editingItem = items.find((item) => item.id === favoritesEditingId);

  if (favoritesMode === "edit" && editingItem) {
    fragment.appendChild(createEditForm(editingItem));
  }
```

- [ ] **Step 3: Wire edit mode click actions**

Extend the favorites click listener:

```js
    } else if (action === "toggle-edit") {
      favoritesMode = favoritesMode === "edit" ? "view" : "edit";
      favoritesEditingId = null;
      favoritesError = "";
      renderFavorites();
    } else if (action === "edit") {
      favoritesEditingId = target.dataset.favoriteId ?? null;
      favoritesError = "";
      renderFavorites();
    } else if (action === "delete") {
      void (async () => {
        try {
          favoritesState = await favoritesService.deleteFavorite(target.dataset.favoriteId);
          favoritesEditingId = null;
          favoritesError = "";
          renderFavorites();
        } catch (error) {
          favoritesError = error instanceof Error ? error.message : String(error);
          renderFavorites();
        }
      })();
    } else if (action === "move-left" || action === "move-right") {
      void (async () => {
        try {
          favoritesState = await favoritesService.moveFavorite(
            target.dataset.favoriteId,
            action === "move-left" ? -1 : 1
          );
          favoritesError = "";
          renderFavorites();
        } catch (error) {
          favoritesError = error instanceof Error ? error.message : String(error);
          renderFavorites();
        }
      })();
```

- [ ] **Step 4: Wire edit form submit**

Extend the submit listener:

```js
    if (form.dataset.favoriteForm === "edit") {
      event.preventDefault();

      void (async () => {
        const data = new FormData(form);

        try {
          favoritesState = await favoritesService.updateFavorite(form.dataset.favoriteId, {
            url: data.get("url"),
            label: data.get("label"),
            iconMode: data.get("iconMode"),
            customIconUrl: data.get("customIconUrl"),
            backgroundColor: data.get("backgroundColor"),
            backgroundColorSource: data.get("backgroundColorSource")
          });
          favoritesEditingId = null;
          favoritesError = "";
          renderFavorites();
        } catch (error) {
          favoritesError = error instanceof Error ? error.message : String(error);
          renderFavorites();
        }
      })();

      return;
    }
```

Place this before the existing add-form branch, or convert the listener to two explicit branches for `add` and `edit`.

- [ ] **Step 5: Add editor CSS**

Append to `src/newtab.css`:

```css
.favorite-tile-wrap {
  display: grid;
  gap: 6px;
}

.favorite-move-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
}

.favorite-mini-button {
  min-height: 28px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel);
  color: var(--text);
  cursor: pointer;
}

.favorite-mini-button:disabled {
  cursor: default;
  opacity: 0.45;
}

.favorite-form--editor {
  width: min(680px, 100%);
  justify-self: center;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
}

.favorite-color-input {
  width: 48px;
  height: 40px;
  padding: 2px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel);
}

.button--danger {
  border-color: var(--danger);
  color: var(--danger);
}
```

- [ ] **Step 6: Run checks**

Run:

```bash
npm run check
npm test
```

Expected: both PASS.

- [ ] **Step 7: Manual browser verification**

Load unpacked extension and verify:

- Gear toggles edit mode.
- In edit mode, clicking a tile opens the editor instead of navigating.
- URL, label, icon mode, custom image URL, and color can be saved.
- Delete removes the item.
- Move left/right changes order and persists after a new tab reload.
- Normal view still opens links in current tab.

- [ ] **Step 8: Commit**

```bash
git add src/newtab.js src/newtab.css
git commit -m "feat: add favorites editor controls"
```

---

## Task 7: Auto Color Extraction in UI

Use `extractImageBackgroundColor` for auto color when adding or updating favorites, without overriding manual colors.

**Files:**
- Modify: `src/newtab.js`

- [ ] **Step 1: Import extraction helper**

Modify import from `favoriteColor.js`:

```js
import {
  extractImageBackgroundColor,
  fallbackColorForDomain,
  readableTextColor
} from "./favoriteColor.js";
```

- [ ] **Step 2: Add browser image/canvas adapters**

Add near favorites helpers:

```js
function loadBrowserImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Image failed to load"));
    image.src = src;
  });
}

function createBrowserCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function resolveAutoBackgroundColor(item) {
  const fallback = fallbackColorForDomain(item.domain);
  const iconModel = getFavoriteIconModel(item, { extensionId });
  const imageUrl = iconModel.type === "image" ? iconModel.src : "";

  if (!imageUrl) {
    return fallback;
  }

  return (
    (await extractImageBackgroundColor(imageUrl, {
      loadImage: loadBrowserImage,
      createCanvas: createBrowserCanvas
    })) ?? fallback
  );
}
```

- [ ] **Step 3: Use auto color after add**

Replace the add submit payload with:

```js
      const input = {
        url: data.get("url"),
        backgroundColorSource: "auto"
      };

      favoritesState = await favoritesService.addFavorite(input);
```

After save, the item has a fallback color. In this task, immediately attempt to improve it:

```js
      const added = favoritesState.items.at(-1);
      const autoColor = await resolveAutoBackgroundColor(added);

      if (autoColor !== added.backgroundColor) {
        favoritesState = await favoritesService.updateFavorite(added.id, {
          backgroundColor: autoColor,
          backgroundColorSource: "auto"
        });
      }
```

Keep the existing `favoritesMode = "view"` and render after this block.

- [ ] **Step 4: Use auto color on edit when source is not manual**

For edit submit, set:

```js
          const backgroundColorSource = data.get("backgroundColorSource") === "manual" ? "manual" : "auto";
          const input = {
            url: data.get("url"),
            label: data.get("label"),
            iconMode: data.get("iconMode"),
            customIconUrl: data.get("customIconUrl"),
            backgroundColor: data.get("backgroundColor"),
            backgroundColorSource
          };

          favoritesState = await favoritesService.updateFavorite(form.dataset.favoriteId, input);
          const updatedItem = favoritesState.items.find((item) => item.id === form.dataset.favoriteId);

          if (backgroundColorSource === "auto" && updatedItem) {
            const autoColor = await resolveAutoBackgroundColor(updatedItem);

            if (autoColor !== updatedItem.backgroundColor) {
              favoritesState = await favoritesService.updateFavorite(updatedItem.id, {
                backgroundColor: autoColor,
                backgroundColorSource: "auto"
              });
            }
          }
```

- [ ] **Step 5: Run checks**

Run:

```bash
npm run check
npm test
```

Expected: both PASS.

- [ ] **Step 6: Manual browser verification**

Load unpacked extension and verify:

- New favicon tiles get non-identical colors for visibly different favicons when pixel access succeeds.
- If color extraction fails, the fallback color remains stable.
- Manual color saved in editor persists after reload.
- Manual color is not overwritten by image load events or favicon fallback.

- [ ] **Step 7: Commit**

```bash
git add src/newtab.js
git commit -m "feat: apply automatic favorite tile colors"
```

---

## Task 8: CSS Polish and Responsive Verification

Tighten visual layout for wide, medium, and narrow viewports.

**Files:**
- Modify: `src/newtab.css`

- [ ] **Step 1: Refine page layout**

Replace `.page` block with:

```css
.page {
  min-height: 100vh;
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 18px;
  padding: 24px;
}
```

- [ ] **Step 2: Refine tile sizing and focus**

Add or update:

```css
.favorite-tile:hover,
.favorite-settings:hover,
.favorite-mini-button:hover {
  border-color: var(--primary);
}

.favorite-tile:focus-visible,
.favorite-settings:focus-visible,
.favorite-mini-button:focus-visible,
.favorite-input:focus-visible,
.favorite-color-input:focus-visible {
  outline: 3px solid var(--focus);
  outline-offset: 2px;
}

.favorite-tile {
  box-shadow: 0 8px 18px rgb(0 0 0 / 12%);
}

.favorite-tile--add {
  box-shadow: none;
}
```

- [ ] **Step 3: Refine mobile behavior**

Update the existing `@media (max-width: 520px)` block:

```css
@media (max-width: 520px) {
  .page {
    align-content: start;
    padding: 16px;
  }

  .panel {
    padding: 22px;
  }

  .title {
    font-size: 22px;
  }

  .actions,
  .favorite-form {
    flex-direction: column;
  }

  .button,
  .favorite-input {
    width: 100%;
  }

  .favorites-grid {
    --favorite-tile-height: 52px;
  }
}
```

- [ ] **Step 4: Run checks**

Run:

```bash
npm run check
npm test
```

Expected: both PASS.

- [ ] **Step 5: Manual responsive verification**

In Chromium DevTools, check widths 1280, 768, 390:

- At wide width, two or three tiles can stretch wider than square.
- At medium width, tiles shrink before wrapping.
- At mobile width, square tiles wrap cleanly.
- Favicon/letter remains around 30px and does not stretch.
- DTF panel never overlaps favorites panel.
- No button text overflows in editor.

- [ ] **Step 6: Commit**

```bash
git add src/newtab.css
git commit -m "style: polish favorites bar layout"
```

---

## Task 9: Documentation Updates

Document new behavior, local storage, and favicon permission.

**Files:**
- Modify: `README.md`
- Modify: `docs/privacy.md`

- [ ] **Step 1: Update README feature list**

Add bullets under `## Features`:

```markdown
- Shows a personal favorites bar at the top of the new tab page.
- Lets you add, edit, delete, and reorder saved links directly on the new tab page.
- Opens saved favorites in the current tab.
- Uses site favicons with letter and custom-image fallbacks.
```

- [ ] **Step 2: Update README permissions**

Replace the permissions list with:

```markdown
The manifest requests only:

- `storage` to persist the queue and saved favorites locally;
- `favicon` to display site favicons in the favorites bar;
- host access to `https://api.dtf.ru/*` to read the news feed.
```

Add after that list:

```markdown
Favorites are stored in `chrome.storage.local` under the current browser profile.
They are not Chrome bookmarks and are not synced in this version.
```

- [ ] **Step 3: Update privacy doc**

In `docs/privacy.md`, under `## Data Stored`, add:

```markdown
The extension also stores user-created favorite links:

- saved URLs;
- labels;
- domains;
- icon mode and optional custom image URLs;
- tile background colors;
- creation and update timestamps.
```

Under `## Data Sent`, add:

```markdown
For favorites, the extension may ask Chromium for a site's favicon through the
Manifest V3 `_favicon` endpoint. Custom image URLs, if configured by the user,
are loaded by the new tab page so they can be displayed as tile icons.
```

- [ ] **Step 4: Run checks**

Run:

```bash
npm run check
npm test
```

Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/privacy.md
git commit -m "docs: document favorites bar"
```

---

## Task 10: Final Verification

Run the full repository gates and complete a browser sanity pass before declaring the feature done.

**Files:**
- No planned edits.

- [ ] **Step 1: Check git status**

Run: `git status --short`

Expected: no output. If there is output, inspect it with `git diff` and decide whether it belongs to this feature before proceeding.

- [ ] **Step 2: Run all automated checks**

Run:

```bash
npm run check
npm test
```

Expected: both PASS.

- [ ] **Step 3: Load unpacked extension**

In Chromium:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click "Load unpacked".
4. Select `/Users/undevy/dtf-newtab-queue`.
5. Open a new tab.

Expected: favorites bar appears above DTF card.

- [ ] **Step 4: Manual functional pass**

Verify:

- Add `example.com`.
- Add a second URL.
- Reload new tab; both favorites persist.
- Click first favorite; current tab navigates to that URL.
- Return to new tab.
- Use gear mode to rename, recolor, move, and delete a favorite.
- Reload new tab; edits persist.
- DTF actions `Просмотрел`, `Перейти`, `Проверить новые`, `Глубже в архив`, `Сбросить` still render and respond as before.

- [ ] **Step 5: Manual responsive pass**

Verify at desktop and mobile widths:

- Favorite tiles stretch up to 2:1 when space allows.
- Tiles shrink to square before wrapping.
- Tiles wrap only when square tiles no longer fit.
- Icons do not stretch.
- Editor controls remain readable.

- [ ] **Step 6: Final status**

Run:

```bash
git log --oneline -5
git status --short
```

Expected: recent commits include the favorites tasks; status is clean.
