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

export const FAVORITES_STORAGE_KEY = "dtfFavorites";
export const MAX_FAVORITES = 200;

const FAVORITES_VERSION = 1;

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
      return isFavoritesState(state)
        ? cloneValue(state)
        : createInitialFavoritesState(now());
    },

    async setState(state) {
      if (!isFavoritesState(state)) {
        throw new Error("Invalid favorites state");
      }

      const nextState = cloneValue(state);
      await storageArea.set({ [FAVORITES_STORAGE_KEY]: nextState });
      return cloneValue(nextState);
    },

    async clearState() {
      await storageArea.remove(FAVORITES_STORAGE_KEY);
    }
  };
}
