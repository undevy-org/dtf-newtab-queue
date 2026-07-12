import { cloneValue, hasOwnFields, isNonEmptyString, isRecord } from "./storeUtils.js";

export const WEATHER_LOCATION_STORAGE_KEY = "dtfWeatherLocation";
export const WEATHER_CACHE_STORAGE_KEY = "dtfWeatherCache";

const WEATHER_LOCATION_VERSION = 1;
const WEATHER_CACHE_VERSION = 1;

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

export function isWeatherLocation(value) {
  const requiredFields = ["version", "name", "country", "latitude", "longitude"];

  return (
    isRecord(value) &&
    hasOwnFields(value, requiredFields) &&
    value.version === WEATHER_LOCATION_VERSION &&
    isNonEmptyString(value.name) &&
    typeof value.country === "string" &&
    isFiniteNumber(value.latitude) &&
    isFiniteNumber(value.longitude)
  );
}

export function isWeatherCache(value) {
  const requiredFields = [
    "version",
    "locationName",
    "fetchedAt",
    "temperature",
    "uvIndexMax",
    "precipitationProbabilityMax",
    "europeanAqi",
    "pm2_5"
  ];

  return (
    isRecord(value) &&
    hasOwnFields(value, requiredFields) &&
    value.version === WEATHER_CACHE_VERSION &&
    isNonEmptyString(value.locationName) &&
    isFiniteNumber(value.fetchedAt) &&
    isFiniteNumber(value.temperature) &&
    isFiniteNumber(value.uvIndexMax) &&
    isFiniteNumber(value.precipitationProbabilityMax) &&
    isFiniteNumber(value.europeanAqi) &&
    isFiniteNumber(value.pm2_5)
  );
}

export function createWeatherLocationStore(storageArea) {
  return {
    async getLocation() {
      const result = await storageArea.get(WEATHER_LOCATION_STORAGE_KEY);
      const location = result?.[WEATHER_LOCATION_STORAGE_KEY];
      return isWeatherLocation(location) ? cloneValue(location) : null;
    },

    async setLocation(location) {
      const candidate = { version: WEATHER_LOCATION_VERSION, ...location };

      if (!isWeatherLocation(candidate)) {
        throw new Error("Invalid weather location");
      }

      await storageArea.set({ [WEATHER_LOCATION_STORAGE_KEY]: candidate });
      return cloneValue(candidate);
    },

    async clearLocation() {
      await storageArea.remove(WEATHER_LOCATION_STORAGE_KEY);
    }
  };
}

export function createWeatherCacheStore(storageArea) {
  return {
    async getCache() {
      const result = await storageArea.get(WEATHER_CACHE_STORAGE_KEY);
      const cache = result?.[WEATHER_CACHE_STORAGE_KEY];
      return isWeatherCache(cache) ? cloneValue(cache) : null;
    },

    async setCache(cache) {
      const candidate = { version: WEATHER_CACHE_VERSION, ...cache };

      if (!isWeatherCache(candidate)) {
        throw new Error("Invalid weather cache");
      }

      await storageArea.set({ [WEATHER_CACHE_STORAGE_KEY]: candidate });
      return cloneValue(candidate);
    },

    async clearCache() {
      await storageArea.remove(WEATHER_CACHE_STORAGE_KEY);
    }
  };
}
