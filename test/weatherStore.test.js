import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMemoryStorageArea } from "../src/queueStore.js";
import {
  WEATHER_CACHE_STORAGE_KEY,
  WEATHER_LOCATION_STORAGE_KEY,
  createWeatherCacheStore,
  createWeatherLocationStore,
  isWeatherCache,
  isWeatherLocation
} from "../src/weatherStore.js";

function location(overrides = {}) {
  return {
    name: "Тбилиси",
    country: "Georgia",
    latitude: 41.72,
    longitude: 44.78,
    ...overrides
  };
}

function cache(overrides = {}) {
  return {
    locationName: "Тбилиси",
    fetchedAt: 1783900000000,
    temperature: 24,
    uvIndexMax: 6.1,
    precipitationProbabilityMax: 20,
    temperatureTodayAt15: 26.7,
    temperatureYesterdayAt15: 25.2,
    precipitationStartHour: "17:00",
    usAqi: 34,
    pm2_5: 11.4,
    ...overrides
  };
}

describe("createWeatherLocationStore", () => {
  it("returns null when no location is stored", async () => {
    const store = createWeatherLocationStore(createMemoryStorageArea());
    assert.equal(await store.getLocation(), null);
  });

  it("saves and reads back a valid location, versioned", async () => {
    const storageArea = createMemoryStorageArea();
    const store = createWeatherLocationStore(storageArea);

    const saved = await store.setLocation(location());
    assert.equal(saved.version, 1);

    const read = await store.getLocation();
    assert.deepEqual(read, saved);

    const raw = await storageArea.get(WEATHER_LOCATION_STORAGE_KEY);
    assert.equal(raw[WEATHER_LOCATION_STORAGE_KEY].name, "Тбилиси");
  });

  it("rejects an incomplete location", async () => {
    const store = createWeatherLocationStore(createMemoryStorageArea());

    await assert.rejects(() => store.setLocation({ name: "Тбилиси" }));
  });

  it("clears the stored location", async () => {
    const storageArea = createMemoryStorageArea();
    const store = createWeatherLocationStore(storageArea);

    await store.setLocation(location());
    await store.clearLocation();

    assert.equal(await store.getLocation(), null);
  });

  it("treats a corrupted stored location as absent", async () => {
    const storageArea = createMemoryStorageArea({
      [WEATHER_LOCATION_STORAGE_KEY]: { name: "broken" }
    });
    const store = createWeatherLocationStore(storageArea);

    assert.equal(await store.getLocation(), null);
  });
});

describe("createWeatherCacheStore", () => {
  it("returns null when no cache is stored", async () => {
    const store = createWeatherCacheStore(createMemoryStorageArea());
    assert.equal(await store.getCache(), null);
  });

  it("saves and reads back a valid cache entry, versioned", async () => {
    const storageArea = createMemoryStorageArea();
    const store = createWeatherCacheStore(storageArea);

    const saved = await store.setCache(cache());
    assert.equal(saved.version, 2);

    const read = await store.getCache();
    assert.deepEqual(read, saved);
  });

  it("rejects an incomplete cache entry", async () => {
    const store = createWeatherCacheStore(createMemoryStorageArea());

    await assert.rejects(() => store.setCache({ temperature: 24 }));
  });

  it("clears the stored cache", async () => {
    const storageArea = createMemoryStorageArea();
    const store = createWeatherCacheStore(storageArea);

    await store.setCache(cache());
    await store.clearCache();

    assert.equal(await store.getCache(), null);
  });

  it("treats a corrupted stored cache as absent", async () => {
    const storageArea = createMemoryStorageArea({
      [WEATHER_CACHE_STORAGE_KEY]: { temperature: "not-a-number" }
    });
    const store = createWeatherCacheStore(storageArea);

    assert.equal(await store.getCache(), null);
  });

  it("treats a stored v1 cache as absent", async () => {
    const storageArea = createMemoryStorageArea({
      [WEATHER_CACHE_STORAGE_KEY]: { version: 1, ...cache() }
    });
    const store = createWeatherCacheStore(storageArea);

    assert.equal(await store.getCache(), null);
  });

  it("treats a stored v2 cache with an invalid precipitation hour as absent", async () => {
    const storageArea = createMemoryStorageArea({
      [WEATHER_CACHE_STORAGE_KEY]: { version: 2, ...cache({ precipitationStartHour: "17:30" }) }
    });
    const store = createWeatherCacheStore(storageArea);

    assert.equal(await store.getCache(), null);
  });
});

describe("isWeatherLocation / isWeatherCache", () => {
  it("accepts well-formed values", () => {
    assert.equal(isWeatherLocation({ version: 1, ...location() }), true);
    assert.equal(isWeatherCache({ version: 2, ...cache() }), true);
  });

  it("rejects non-finite coordinates and metrics", () => {
    assert.equal(
      isWeatherLocation({ version: 1, ...location({ latitude: Number.NaN }) }),
      false
    );
    assert.equal(
      isWeatherCache({ version: 2, ...cache({ temperature: Number.NaN }) }),
      false
    );
  });

  it("rejects cache records with missing or extra own fields", () => {
    const { usAqi, ...missingUsAqi } = cache();

    assert.equal(isWeatherCache({ version: 2, ...missingUsAqi }), false);
    assert.equal(isWeatherCache({ version: 2, ...cache(), unexpected: true }), false);
  });
});
