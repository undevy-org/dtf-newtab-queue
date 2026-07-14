import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMemoryStorageArea } from "../src/queueStore.js";
import { createWeatherCacheStore, createWeatherLocationStore } from "../src/weatherStore.js";
import { WeatherApiError } from "../src/weatherApi.js";
import { createWeatherService } from "../src/weatherService.js";

const TBILISI = { name: "Тбилиси", country: "Georgia", latitude: 41.72, longitude: 44.78 };
const WEATHER_READING = {
  temperature: 24,
  temperatureTodayAt15: 26.7,
  temperatureYesterdayAt15: 25.2,
  uvIndex: 5.4,
  uvIndexMax: 6.1,
  precipitationProbabilityMax: 20,
  precipitationStartHour: "17:00"
};
const AIR_READING = { usAqi: 34, pm2_5: 11.4 };

function createHarness({
  now = () => 1_000_000,
  fetchWeather = async () => WEATHER_READING,
  fetchAirQuality = async () => AIR_READING,
  geocodeCity = async () => TBILISI
} = {}) {
  const locationStore = createWeatherLocationStore(createMemoryStorageArea());
  const cacheStore = createWeatherCacheStore(createMemoryStorageArea());
  const service = createWeatherService({
    locationStore,
    cacheStore,
    fetchWeather,
    fetchAirQuality,
    geocodeCity,
    now
  });

  return { locationStore, cacheStore, service };
}

describe("createWeatherService", () => {
  it("reports no-location before any city is set", async () => {
    const { service } = createHarness();
    const result = await service.initialize();

    assert.equal(result.status, "no-location");
    assert.equal(result.location, null);
    assert.equal(result.data, null);
  });

  it("setCity geocodes, persists the location, and fetches weather+air quality", async () => {
    const calls = [];
    const { service, locationStore } = createHarness({
      fetchWeather: async (args) => {
        calls.push(["weather", args]);
        return WEATHER_READING;
      },
      fetchAirQuality: async (args) => {
        calls.push(["air", args]);
        return AIR_READING;
      }
    });

    const result = await service.setCity("Тбилиси");

    assert.equal(result.status, "ready");
    assert.equal(result.location.name, "Тбилиси");
    assert.equal(result.data.temperature, 24);
    assert.equal(result.data.usAqi, 34);
    assert.equal(result.data.temperatureTodayAt15, 26.7);
    assert.equal(result.data.temperatureYesterdayAt15, 25.2);
    assert.equal(result.data.precipitationStartHour, "17:00");
    assert.deepEqual(await locationStore.getLocation(), result.location);
    assert.deepEqual(
      calls.map(([kind, args]) => [kind, args.latitude, args.longitude]),
      [
        ["weather", 41.72, 44.78],
        ["air", 41.72, 44.78]
      ]
    );
  });

  it("propagates geocoding failure without persisting a location", async () => {
    const { service, locationStore } = createHarness({
      geocodeCity: async () => {
        throw new WeatherApiError('City "Незнакомоместо" was not found');
      }
    });

    await assert.rejects(
      () => service.setCity("Незнакомоместо"),
      (error) => error instanceof WeatherApiError
    );
    assert.equal(await locationStore.getLocation(), null);
  });

  it("returns ready from a fresh cache without calling fetch again", async () => {
    let fetchCalls = 0;
    const harness = createHarness({
      fetchWeather: async () => {
        fetchCalls += 1;
        return WEATHER_READING;
      }
    });

    await harness.service.setCity("Тбилиси");
    fetchCalls = 0;

    const result = await harness.service.initialize();

    assert.equal(result.status, "ready");
    assert.equal(fetchCalls, 0);
  });

  it("refetches once the cache is older than 30 minutes", async () => {
    let clock = 1_000_000;
    let fetchCalls = 0;
    const harness = createHarness({
      now: () => clock,
      fetchWeather: async () => {
        fetchCalls += 1;
        return WEATHER_READING;
      }
    });

    await harness.service.setCity("Тбилиси");
    fetchCalls = 0;
    clock += 30 * 60 * 1000 + 1;

    const result = await harness.service.initialize();

    assert.equal(result.status, "ready");
    assert.equal(fetchCalls, 1);
  });

  it("falls back to a stale cache with an error message when a refetch fails", async () => {
    let clock = 1_000_000;
    let shouldFail = false;
    const harness = createHarness({
      now: () => clock,
      fetchWeather: async () => {
        if (shouldFail) {
          throw new WeatherApiError("Open-Meteo forecast request failed with status 503");
        }
        return WEATHER_READING;
      }
    });

    await harness.service.setCity("Тбилиси");
    clock += 30 * 60 * 1000 + 1;
    shouldFail = true;

    const result = await harness.service.initialize();

    assert.equal(result.status, "stale");
    assert.equal(result.data.temperature, 24);
    assert.match(result.error, /503/);
  });

  it("reports error with no data when there is no cache and the fetch fails", async () => {
    const harness = createHarness({
      fetchWeather: async () => {
        throw new WeatherApiError("Open-Meteo forecast request failed with status 500");
      }
    });

    await harness.locationStore.setLocation(TBILISI);
    const result = await harness.service.initialize();

    assert.equal(result.status, "error");
    assert.equal(result.data, null);
    assert.match(result.error, /500/);
  });

  it("forces a fresh fetch when the city changes, ignoring TTL", async () => {
    let fetchCalls = 0;
    const harness = createHarness({
      fetchWeather: async () => {
        fetchCalls += 1;
        return WEATHER_READING;
      },
      geocodeCity: async (name) => ({ ...TBILISI, name })
    });

    await harness.service.setCity("Тбилиси");
    fetchCalls = 0;

    const result = await harness.service.setCity("Батуми");

    assert.equal(result.location.name, "Батуми");
    assert.equal(fetchCalls, 1);
  });

  it("resolves with status error instead of throwing when locationStore.getLocation() rejects", async () => {
    const cacheStore = createWeatherCacheStore(createMemoryStorageArea());
    const service = createWeatherService({
      locationStore: {
        getLocation: async () => {
          throw new Error("extension context invalidated");
        },
        setLocation: async () => {
          throw new Error("not expected to be called");
        }
      },
      cacheStore,
      fetchWeather: async () => WEATHER_READING,
      fetchAirQuality: async () => AIR_READING,
      geocodeCity: async () => TBILISI,
      now: () => 1_000_000
    });

    await assert.doesNotReject(() => service.initialize());
    const result = await service.initialize();

    assert.equal(result.status, "error");
    assert.equal(result.location, null);
    assert.equal(result.data, null);
    assert.equal(typeof result.error, "string");
    assert.notEqual(result.error, null);
  });

  it("resolves with status error and the resolved location when cacheStore.getCache() rejects", async () => {
    const locationStore = createWeatherLocationStore(createMemoryStorageArea());
    await locationStore.setLocation(TBILISI);

    const service = createWeatherService({
      locationStore,
      cacheStore: {
        getCache: async () => {
          throw new Error("extension context invalidated");
        },
        setCache: async () => {
          throw new Error("not expected to be called");
        }
      },
      fetchWeather: async () => WEATHER_READING,
      fetchAirQuality: async () => AIR_READING,
      geocodeCity: async () => TBILISI,
      now: () => 1_000_000
    });

    await assert.doesNotReject(() => service.initialize());
    const result = await service.initialize();

    assert.equal(result.status, "error");
    assert.notEqual(result.location, null);
    assert.equal(result.location.name, TBILISI.name);
    assert.equal(result.data, null);
    assert.equal(typeof result.error, "string");
    assert.notEqual(result.error, null);
  });
});
