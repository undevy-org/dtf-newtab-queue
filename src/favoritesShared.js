export const ICON_MODES = new Set(["favicon", "letter", "custom"]);
export const BACKGROUND_COLOR_SOURCES = new Set(["auto", "manual"]);
export const TILE_SIZES = new Set(["square", "wide"]);
export const HEX_COLOR_VALIDATION_PATTERN = /^#[0-9a-f]{6}$/i;

export function trimString(value) {
  return typeof value === "string" ? value.trim() : "";
}
