export const FAVORITES_STORAGE_KEY = "dtfFavorites";
export const MAX_FAVORITES = 200;

const FAVORITES_VERSION = 1;
const ICON_MODES = new Set(["favicon", "letter", "custom"]);
const BACKGROUND_COLOR_SOURCES = new Set(["auto", "manual"]);
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

export function createInitialFavoritesState(now = new Date().toISOString()) {
  return {
    version: FAVORITES_VERSION,
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
    typeof value.backgroundColor === "string" &&
    HEX_COLOR_PATTERN.test(value.backgroundColor) &&
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

function cloneValue(value) {
  return structuredClone(value);
}
