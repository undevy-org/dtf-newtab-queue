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

const HEX_COLOR_PATTERN = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;

function componentToHex(value) {
  return value.toString(16).padStart(2, "0");
}

function rgbToHex(red, green, blue) {
  return `#${componentToHex(red)}${componentToHex(green)}${componentToHex(blue)}`;
}

function rgbToHsl(red, green, blue) {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;

  if (max === min) {
    return { hue: 0, saturation: 0, lightness };
  }

  const delta = max - min;
  const saturation =
    lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);

  let hue;
  if (max === r) {
    hue = (g - b) / delta + (g < b ? 6 : 0);
  } else if (max === g) {
    hue = (b - r) / delta + 2;
  } else {
    hue = (r - g) / delta + 4;
  }
  hue /= 6;

  return { hue, saturation, lightness };
}

function hueToRgbComponent(p, q, t) {
  let temp = t;
  if (temp < 0) temp += 1;
  if (temp > 1) temp -= 1;
  if (temp < 1 / 6) return p + (q - p) * 6 * temp;
  if (temp < 1 / 2) return q;
  if (temp < 2 / 3) return p + (q - p) * (2 / 3 - temp) * 6;
  return p;
}

function hslToRgb(hue, saturation, lightness) {
  if (saturation === 0) {
    const value = Math.round(lightness * 255);
    return { red: value, green: value, blue: value };
  }

  const q =
    lightness < 0.5
      ? lightness * (1 + saturation)
      : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;

  return {
    red: Math.round(hueToRgbComponent(p, q, hue + 1 / 3) * 255),
    green: Math.round(hueToRgbComponent(p, q, hue) * 255),
    blue: Math.round(hueToRgbComponent(p, q, hue - 1 / 3) * 255)
  };
}

function quantizeColor(value) {
  return Math.min(Math.round(value / 8) * 8, 248);
}

function isUninformativeNeutralColor(red, green, blue) {
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const average = (red + green + blue) / 3;

  return maximum - minimum <= 12 && average >= 70 && average <= 190;
}

function parseHexColor(color) {
  const match = HEX_COLOR_PATTERN.exec(color);

  if (!match) {
    throw new Error("Use a hex color like #24292f");
  }

  return {
    red: Number.parseInt(match[1], 16),
    green: Number.parseInt(match[2], 16),
    blue: Number.parseInt(match[3], 16)
  };
}

function relativeLuminanceComponent(value) {
  const channel = value / 255;
  return channel <= 0.03928
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

export function fallbackColorForDomain(domain) {
  const value = String(domain ?? "").trim().toLowerCase();
  let hash = 0;

  for (const character of value) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }

  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length];
}

export function pickDominantColorFromPixels(pixels) {
  const buckets = new Map();
  let bestBucket = null;

  for (let index = 0; index + 3 < pixels.length; index += 4) {
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    const alpha = pixels[index + 3];

    if (
      alpha < 128 ||
      (red > 232 && green > 232 && blue > 232) ||
      isUninformativeNeutralColor(red, green, blue)
    ) {
      continue;
    }

    const bucketKey = [
      quantizeColor(red),
      quantizeColor(green),
      quantizeColor(blue)
    ].join(",");
    const bucket = buckets.get(bucketKey) ?? {
      count: 0,
      red: 0,
      green: 0,
      blue: 0
    };

    bucket.count += 1;
    bucket.red += red;
    bucket.green += green;
    bucket.blue += blue;
    buckets.set(bucketKey, bucket);

    if (bestBucket === null || bucket.count > bestBucket.count) {
      bestBucket = bucket;
    }
  }

  if (bestBucket === null) {
    return null;
  }

  return rgbToHex(
    Math.round(bestBucket.red / bestBucket.count),
    Math.round(bestBucket.green / bestBucket.count),
    Math.round(bestBucket.blue / bestBucket.count)
  );
}

export function readableTextColor(backgroundColor) {
  const { red, green, blue } = parseHexColor(backgroundColor);
  const luminance =
    0.2126 * relativeLuminanceComponent(red) +
    0.7152 * relativeLuminanceComponent(green) +
    0.0722 * relativeLuminanceComponent(blue);

  return luminance > 0.55 ? "#111318" : "#ffffff";
}

const ACCENT_MIN_LIGHTNESS = 0.45;
const ACCENT_MAX_LIGHTNESS = 0.7;

export function hexToRgbChannels(hex) {
  const { red, green, blue } = parseHexColor(hex);
  return `${red}, ${green}, ${blue}`;
}

export function normalizeAccentLightness(hex) {
  const { red, green, blue } = parseHexColor(hex);
  const { hue, saturation, lightness } = rgbToHsl(red, green, blue);
  const clamped = Math.min(
    Math.max(lightness, ACCENT_MIN_LIGHTNESS),
    ACCENT_MAX_LIGHTNESS
  );

  if (clamped === lightness) {
    return hex.toLowerCase();
  }

  const next = hslToRgb(hue, saturation, clamped);
  return rgbToHex(next.red, next.green, next.blue);
}

export async function extractImageBackgroundColor(
  imageUrl,
  options = {}
) {
  const { loadImage, createCanvas, sampleSize = 32 } = options;

  if (typeof loadImage !== "function") {
    throw new TypeError("loadImage must be a function");
  }

  if (typeof createCanvas !== "function") {
    throw new TypeError("createCanvas must be a function");
  }

  try {
    const image = await loadImage(imageUrl);
    const canvas = createCanvas(sampleSize, sampleSize);
    const context = canvas.getContext("2d", { willReadFrequently: true });

    context.drawImage(image, 0, 0, sampleSize, sampleSize);

    return pickDominantColorFromPixels(
      context.getImageData(0, 0, sampleSize, sampleSize).data
    );
  } catch {
    return null;
  }
}
