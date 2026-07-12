import {
  fetchAirQuality as defaultFetchAirQuality,
  fetchWeather as defaultFetchWeather,
  geocodeCity as defaultGeocodeCity
} from "./weatherApi.js";

const WEATHER_CACHE_TTL_MS = 30 * 60 * 1000;

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function isCacheFresh(cache, location, now) {
  return (
    cache !== null &&
    location !== null &&
    cache.locationName === location.name &&
    now - cache.fetchedAt < WEATHER_CACHE_TTL_MS
  );
}

export function createWeatherService({
  locationStore,
  cacheStore,
  fetchWeather = defaultFetchWeather,
  fetchAirQuality = defaultFetchAirQuality,
  geocodeCity = defaultGeocodeCity,
  now = () => Date.now()
}) {
  async function fetchAndCache(location) {
    const [weather, airQuality] = await Promise.all([
      fetchWeather({ latitude: location.latitude, longitude: location.longitude }),
      fetchAirQuality({ latitude: location.latitude, longitude: location.longitude })
    ]);

    return cacheStore.setCache({
      locationName: location.name,
      fetchedAt: now(),
      temperature: weather.temperature,
      uvIndexMax: weather.uvIndexMax,
      precipitationProbabilityMax: weather.precipitationProbabilityMax,
      europeanAqi: airQuality.europeanAqi,
      pm2_5: airQuality.pm2_5
    });
  }

  return {
    async initialize() {
      const location = await locationStore.getLocation();

      if (!location) {
        return { status: "no-location", location: null, data: null, error: null };
      }

      const cached = await cacheStore.getCache();

      if (isCacheFresh(cached, location, now())) {
        return { status: "ready", location, data: cached, error: null };
      }

      try {
        const data = await fetchAndCache(location);
        return { status: "ready", location, data, error: null };
      } catch (error) {
        if (cached && cached.locationName === location.name) {
          return { status: "stale", location, data: cached, error: errorMessage(error) };
        }
        return { status: "error", location, data: null, error: errorMessage(error) };
      }
    },

    async setCity(name) {
      const resolved = await geocodeCity(name);
      const location = await locationStore.setLocation(resolved);

      try {
        const data = await fetchAndCache(location);
        return { status: "ready", location, data, error: null };
      } catch (error) {
        return { status: "error", location, data: null, error: errorMessage(error) };
      }
    }
  };
}
