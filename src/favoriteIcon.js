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
      alt
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
      alt
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
