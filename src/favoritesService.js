import { createMutationLock } from "./mutationLock.js";
import { MAX_FAVORITES } from "./favoritesStore.js";
import {
  BACKGROUND_COLOR_SOURCES,
  HEX_COLOR_VALIDATION_PATTERN,
  ICON_MODES,
  TILE_SIZES,
  trimString
} from "./favoritesShared.js";

const URL_SCHEME_PATTERN = /^([a-z][a-z\d+.-]*):(.*)$/i;
const FAVORITES_MUTATION_LOCK_NAME = "dtf-newtab-queue-extension:favorites-mutation";
const withFavoritesMutationLock = createMutationLock(FAVORITES_MUTATION_LOCK_NAME);

function hasUrlScheme(value) {
  const match = value.match(URL_SCHEME_PATTERN);

  if (!match) {
    return false;
  }

  const [, , rest] = match;
  if (rest.startsWith("//")) {
    return true;
  }

  return !isHostPortWithoutScheme(rest);
}

function isHostPortWithoutScheme(rest) {
  return /^\d+(?:[/?#]|$)/.test(rest);
}

function ensureUrlProtocol(input) {
  const value = trimString(input);

  if (value === "") {
    throw new Error("Enter a URL");
  }

  return hasUrlScheme(value) ? value : `https://${value}`;
}

function ensureNullableUrlProtocol(input) {
  const value = trimString(input);
  return hasUrlScheme(value) ? value : `https://${value}`;
}

export function normalizeFavoriteUrl(input) {
  const value = ensureUrlProtocol(input);
  let parsed;

  try {
    parsed = new URL(value);
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
  const value = trimString(input);

  if (value === "") {
    return null;
  }

  let parsed;
  try {
    parsed = new URL(ensureNullableUrlProtocol(value));
  } catch {
    throw new Error("Enter a valid image URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http and https image URLs are supported");
  }

  return parsed.href;
}

function normalizeLabel(label, domain) {
  return trimString(label) || domain;
}

function normalizeIconMode(iconMode) {
  if (!ICON_MODES.has(iconMode)) {
    throw new Error("Choose a supported icon mode");
  }

  return iconMode;
}

function normalizeBackgroundColorSource(backgroundColorSource) {
  if (!BACKGROUND_COLOR_SOURCES.has(backgroundColorSource)) {
    throw new Error("Choose a supported background color source");
  }

  return backgroundColorSource;
}

function normalizeTileSize(tileSize) {
  if (!TILE_SIZES.has(tileSize)) {
    throw new Error("Choose a supported tile size");
  }

  return tileSize;
}

function deriveBackgroundColorSource(input, fallbackSource) {
  const source =
    input.backgroundColorSource ??
    (trimString(input.backgroundColor) ? "manual" : fallbackSource);

  return normalizeBackgroundColorSource(source);
}

function normalizeBackgroundColor(backgroundColor, domain, defaultBackgroundColor) {
  const color =
    trimString(backgroundColor) || trimString(defaultBackgroundColor(domain));

  if (!HEX_COLOR_VALIDATION_PATTERN.test(color)) {
    throw new Error("Use a hex color like #24292f");
  }

  return color.toLowerCase();
}

function inputObject(input) {
  return input !== null && typeof input === "object" && !Array.isArray(input)
    ? input
    : {};
}

function createDefaultId() {
  return `fav-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeMoveDirection(direction) {
  if (typeof direction !== "number" || !Number.isFinite(direction)) {
    throw new Error("Move direction must be a finite number");
  }

  return Math.sign(direction);
}

export function createFavoritesService({
  store,
  now = () => new Date().toISOString(),
  createId = createDefaultId,
  defaultBackgroundColor = () => "#24292f"
}) {
  return {
    getState() {
      return store.getState();
    },

    async addFavorite(input) {
      return withFavoritesMutationLock(async () => {
        const payload = inputObject(input);
        const state = await store.getState();

        if (state.items.length >= MAX_FAVORITES) {
          throw new Error(`You can save up to ${MAX_FAVORITES} favorites`);
        }

        const createdAt = now();
        const normalizedUrl = normalizeFavoriteUrl(payload.url);
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

        return store.setState({
          ...state,
          items: [...state.items, item],
          updatedAt: createdAt
        });
      });
    },

    async updateFavorite(id, input) {
      return withFavoritesMutationLock(async () => {
        const payload = inputObject(input);
        const state = await store.getState();
        const index = state.items.findIndex((item) => item.id === id);

        if (index === -1) {
          throw new Error("Favorite not found");
        }

        const updatedAt = now();
        const current = state.items[index];
        const nextItem = { ...current };

        if (Object.hasOwn(payload, "url")) {
          const normalizedUrl = normalizeFavoriteUrl(payload.url);
          nextItem.url = normalizedUrl.url;
          nextItem.domain = normalizedUrl.domain;
        }

        if (Object.hasOwn(payload, "label")) {
          nextItem.label = normalizeLabel(payload.label, nextItem.domain);
        }

        if (Object.hasOwn(payload, "iconMode")) {
          nextItem.iconMode = normalizeIconMode(payload.iconMode);
        }

        if (Object.hasOwn(payload, "customIconUrl")) {
          nextItem.customIconUrl = normalizeNullableImageUrl(payload.customIconUrl);
        }

        if (Object.hasOwn(payload, "backgroundColor")) {
          nextItem.backgroundColor = normalizeBackgroundColor(
            payload.backgroundColor,
            nextItem.domain,
            defaultBackgroundColor
          );
        }

        if (Object.hasOwn(payload, "backgroundColorSource")) {
          nextItem.backgroundColorSource = normalizeBackgroundColorSource(
            payload.backgroundColorSource
          );
        } else if (Object.hasOwn(payload, "backgroundColor")) {
          nextItem.backgroundColorSource = deriveBackgroundColorSource(
            payload,
            "auto"
          );
        }

        if (Object.hasOwn(payload, "tileSize")) {
          nextItem.tileSize = normalizeTileSize(payload.tileSize);
        }

        nextItem.updatedAt = updatedAt;

        const items = state.items.with(index, nextItem);
        return store.setState({
          ...state,
          items,
          updatedAt
        });
      });
    },

    async deleteFavorite(id) {
      return withFavoritesMutationLock(async () => {
        const state = await store.getState();
        const index = state.items.findIndex((item) => item.id === id);

        if (index === -1) {
          throw new Error("Favorite not found");
        }

        const updatedAt = now();
        return store.setState({
          ...state,
          items: state.items.filter((item) => item.id !== id),
          updatedAt
        });
      });
    },

    async moveFavorite(id, direction) {
      return withFavoritesMutationLock(async () => {
        const state = await store.getState();
        const index = state.items.findIndex((item) => item.id === id);

        if (index === -1) {
          throw new Error("Favorite not found");
        }

        const step = normalizeMoveDirection(direction);
        const nextIndex = clamp(index + step, 0, state.items.length - 1);
        if (nextIndex === index) {
          return state;
        }

        const updatedAt = now();
        const items = [...state.items];
        const [item] = items.splice(index, 1);
        items.splice(nextIndex, 0, item);

        return store.setState({
          ...state,
          items,
          updatedAt
        });
      });
    }
  };
}
