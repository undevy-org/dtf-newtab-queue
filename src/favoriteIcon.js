import { trimString } from "./favoritesShared.js";

export const FAVICON_SIZE = 32;

function getAltText(item) {
  return item.label || item.domain;
}

export function getFaviconUrl({ baseUrl, pageUrl, size = FAVICON_SIZE }) {
  const params = new URLSearchParams({
    pageUrl,
    size: String(size)
  });

  return `${baseUrl}?${params.toString()}`;
}

export function getFavoriteIconModel(item, { faviconBaseUrl } = {}) {
  const alt = getAltText(item);

  if (item.iconMode === "custom" && item.customIconUrl) {
    return {
      type: "image",
      src: item.customIconUrl,
      alt,
      // Arbitrary third-party hosts rarely send CORS headers, so reading
      // their pixels into a canvas would fail — don't attempt it.
      sampleable: false
    };
  }

  if (item.iconMode === "favicon" && faviconBaseUrl) {
    return {
      type: "image",
      src: getFaviconUrl({
        baseUrl: faviconBaseUrl,
        pageUrl: item.url,
        size: FAVICON_SIZE
      }),
      alt,
      // Served through the extension's own same-origin favicon proxy.
      sampleable: true
    };
  }

  return {
    type: "letter",
    letter: getFavoriteLetter(item),
    alt
  };
}

export function getFavoriteLetter(item) {
  const source = trimString(item.label) || trimString(item.domain) || "?";
  return Array.from(source)[0].toLocaleUpperCase("ru-RU");
}
