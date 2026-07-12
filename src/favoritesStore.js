import {
  cloneValue,
  hasOwnFields,
  isNonEmptyString,
  isParseableTimestamp,
  isRecord
} from "./storeUtils.js";
import {
  BACKGROUND_COLOR_SOURCES,
  HEX_COLOR_VALIDATION_PATTERN,
  ICON_MODES,
  TILE_SIZES
} from "./favoritesShared.js";

// Legacy single-blob key. Read only by migrateLegacyFavorites() below; the
// live store shards across FAVORITES_META_KEY + one favoriteItemStorageKey()
// per item instead, since chrome.storage.sync caps a single key at 8KB and a
// full 200-item blob can exceed that many times over.
export const FAVORITES_STORAGE_KEY = "dtfFavorites";
export const FAVORITES_META_KEY = "dtfFavoritesMeta";
export const MAX_FAVORITES = 200;

const FAVORITES_VERSION = 1;

export function favoriteItemStorageKey(id) {
  return `dtfFavorite:${id}`;
}

export function createInitialFavoritesState(now = new Date().toISOString()) {
  return {
    version: FAVORITES_VERSION,
    items: [],
    createdAt: now,
    updatedAt: now
  };
}

function isHttpUrl(value) {
  if (!isNonEmptyString(value)) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isCustomIconUrl(value) {
  return value === null || isHttpUrl(value);
}

function isOptionalTileSize(value) {
  return !Object.hasOwn(value, "tileSize") || TILE_SIZES.has(value.tileSize);
}

function isFavoriteItem(value) {
  const requiredFields = [
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
  ];

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
}

function isFavoritesMeta(value) {
  const requiredFields = ["version", "order", "createdAt", "updatedAt"];

  return (
    isRecord(value) &&
    hasOwnFields(value, requiredFields) &&
    value.version === FAVORITES_VERSION &&
    Array.isArray(value.order) &&
    value.order.length <= MAX_FAVORITES &&
    value.order.every(isNonEmptyString) &&
    new Set(value.order).size === value.order.length &&
    isParseableTimestamp(value.createdAt) &&
    isParseableTimestamp(value.updatedAt)
  );
}

export function isFavoritesState(value) {
  const requiredFields = ["version", "items", "createdAt", "updatedAt"];

  return (
    isRecord(value) &&
    hasOwnFields(value, requiredFields) &&
    value.version === FAVORITES_VERSION &&
    Array.isArray(value.items) &&
    value.items.length <= MAX_FAVORITES &&
    value.items.every(isFavoriteItem) &&
    isParseableTimestamp(value.createdAt) &&
    isParseableTimestamp(value.updatedAt)
  );
}

async function readMeta(storageArea) {
  const result = await storageArea.get(FAVORITES_META_KEY);
  const meta = result?.[FAVORITES_META_KEY];
  return isFavoritesMeta(meta) ? meta : null;
}

export function createFavoritesStore(
  storageArea,
  { now = () => new Date().toISOString() } = {}
) {
  return {
    async getState() {
      const meta = await readMeta(storageArea);

      if (!meta) {
        return createInitialFavoritesState(now());
      }

      if (meta.order.length === 0) {
        const empty = {
          version: FAVORITES_VERSION,
          items: [],
          createdAt: meta.createdAt,
          updatedAt: meta.updatedAt
        };
        return isFavoritesState(empty) ? empty : createInitialFavoritesState(now());
      }

      const itemKeys = meta.order.map(favoriteItemStorageKey);
      const itemsResult = await storageArea.get(itemKeys);
      const items = meta.order
        .map((id) => itemsResult[favoriteItemStorageKey(id)])
        .filter((item) => isFavoriteItem(item));

      const candidate = {
        version: FAVORITES_VERSION,
        items,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt
      };
      return isFavoritesState(candidate)
        ? cloneValue(candidate)
        : createInitialFavoritesState(now());
    },

    async setState(state) {
      if (!isFavoritesState(state)) {
        throw new Error("Invalid favorites state");
      }

      const nextState = cloneValue(state);
      const previousMeta = await readMeta(storageArea);
      const previousOrder = previousMeta?.order ?? [];
      const nextOrder = nextState.items.map((item) => item.id);
      const nextIds = new Set(nextOrder);
      const removedIds = previousOrder.filter((id) => !nextIds.has(id));

      const writePayload = {
        [FAVORITES_META_KEY]: {
          version: FAVORITES_VERSION,
          order: nextOrder,
          createdAt: nextState.createdAt,
          updatedAt: nextState.updatedAt
        }
      };
      for (const item of nextState.items) {
        writePayload[favoriteItemStorageKey(item.id)] = item;
      }

      try {
        await storageArea.set(writePayload);
      } catch (cause) {
        throw new Error(
          "Couldn't save this change to Chrome Sync — it may be full, offline, or temporarily unavailable. Try removing a few favorites or try again shortly.",
          { cause }
        );
      }

      if (removedIds.length > 0) {
        await storageArea.remove(removedIds.map(favoriteItemStorageKey));
      }

      return cloneValue(nextState);
    },

    async clearState() {
      const meta = await readMeta(storageArea);
      const order = meta?.order ?? [];
      await storageArea.remove([FAVORITES_META_KEY, ...order.map(favoriteItemStorageKey)]);
    }
  };
}

export async function migrateLegacyFavorites(
  localStorageArea,
  syncFavoritesStore,
  { now = () => new Date().toISOString() } = {}
) {
  const result = await localStorageArea.get(FAVORITES_STORAGE_KEY);
  const hasLegacy = Object.hasOwn(result ?? {}, FAVORITES_STORAGE_KEY);

  if (!hasLegacy) {
    return { migrated: false };
  }

  const legacyState = result[FAVORITES_STORAGE_KEY];

  if (!isFavoritesState(legacyState)) {
    await localStorageArea.remove(FAVORITES_STORAGE_KEY);
    return { migrated: false, discardedCorrupt: true };
  }

  await syncFavoritesStore.setState({ ...legacyState, updatedAt: now() });
  await localStorageArea.remove(FAVORITES_STORAGE_KEY);
  return { migrated: true };
}
