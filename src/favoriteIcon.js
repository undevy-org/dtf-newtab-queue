function trimString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function getAltText(item) {
  return item.label || item.domain;
}

export function getFaviconUrl({ extensionId, pageUrl, size = 64 }) {
  const params = new URLSearchParams({
    pageUrl,
    size: String(size)
  });

  return `chrome-extension://${extensionId}/_favicon/?${params.toString()}`;
}

export function getFavoriteIconModel(item, { extensionId } = {}) {
  const alt = getAltText(item);

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

export function getFavoriteLetter(item) {
  const source = trimString(item.label) || trimString(item.domain) || "?";
  return Array.from(source)[0].toLocaleUpperCase("ru-RU");
}
