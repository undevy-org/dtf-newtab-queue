# Weather Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a weather panel below the DTF news card showing temperature, UV
index, today's rain probability, and air quality — sourced entirely from
Open-Meteo's key-less API, with a user-entered city persisted across devices.

**Architecture:** A new, fully independent subsystem parallel to `favorites`
and the DTF queue, following the same `api` / `store` / `service` (+
`uiState`) split already used by those two subsystems. Three new Open-Meteo
endpoints (forecast, air quality, geocoding) require three new
`host_permissions`. City lives in `chrome.storage.sync`; the 30-minute
weather/AQI cache lives in `chrome.storage.local`. The panel renders as a
third top-level section inside `<main class="page">`, right after `#app`.

**Tech Stack:** Vanilla ES modules, no bundler, no new npm dependency. Tests
via Node's built-in `node --test` (`npm test`), syntax gate via `npm run
check`. Target repo: `dtf-newtab-queue` (not the `~/newtab-widgets`
platform fork — confirmed with the user during brainstorming).

## Global Constraints

- No build step exists in this repo (no bundler): every new file is a plain
  ES module importable by a `<script type="module">`, Node >= 20 for
  `node --test`.
- No API key anywhere in the code. Open-Meteo's key-less, non-commercial
  endpoints only.
- Exactly three new `host_permissions` entries, no wildcard domain:
  `https://api.open-meteo.com/*`, `https://air-quality-api.open-meteo.com/*`,
  `https://geocoding-api.open-meteo.com/*`.
- City → `chrome.storage.sync`, key `dtfWeatherLocation`. Weather+AQI
  reading → `chrome.storage.local`, key `dtfWeatherCache`, 30-minute
  (`30 * 60 * 1000` ms) freshness window.
- One active city only. No `navigator.geolocation`, no IP-geolocation, no
  hourly/nowcast rain, no unit toggle, no background `alarms`/service
  worker — weather only refreshes on new-tab open, and only if the cache is
  stale or the city changed.
- All user-facing copy is Russian, matching the existing tone in
  `src/newtab.js` (queue card + favorites panel).
- Every new module ships `node --test` coverage under `test/*.test.js`
  (already globbed by `npm test`); every new `src/*.js` file must pass
  `npm run check` (`node --check`).
- A failure anywhere in the weather subsystem must never block or hide
  `#app` (news card) or `#favorites` — same isolation already used for
  favorites vs. the queue.

---

### Task 0: Independent plan self-review

**Files:** none — this task only reads `docs/superpowers/specs/2026-07-12-weather-widget-design.md`
and this plan file.

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: a go/no-go gate. Do not start Task 1 until this task's review
  comes back clean.

- [ ] **Step 1: Dispatch a fresh, independent review agent**

Use the `Agent` tool (a general-purpose subagent with no prior context from
this implementation session) with this exact prompt:

```
You are reviewing an implementation plan before any code is written — you
are not implementing anything yourself. Read the spec at
docs/superpowers/specs/2026-07-12-weather-widget-design.md and the plan at
docs/superpowers/plans/2026-07-12-weather-widget.md in full. Then check, in
order:

1. Spec coverage: for every requirement in the spec's "Цели", "Не цели",
   "Данные Open-Meteo", "Модель данных", "UI", "Кэширование и обновление",
   "Ошибки", "Манифест", and "Тестирование" sections, confirm at least one
   task in the plan implements or explicitly accounts for it. List any spec
   requirement with no corresponding task.
2. Placeholder scan: search the plan for "TBD", "TODO", "implement later",
   "similar to Task N", "add appropriate error handling", or any step that
   describes what to do without showing the actual code.
3. Interface/type consistency: for every function, constant, and object
   shape a task's "Consumes" section references from an earlier task,
   confirm the earlier task's "Produces" section defines exactly that name
   and shape (same function name, same parameter names, same returned
   field names). Flag any mismatch, including subtle ones like a field
   named `data` in one task and `weatherData` in another.
4. Grounding against the real repository: open the actual current versions
   of every existing file the plan references or modifies (manifest.json,
   test/manifest.test.js, src/newtab.html, src/newtab.js, src/newtab.css,
   src/storeUtils.js, src/queueStore.js, src/icons.js) and confirm the
   plan's quoted anchor text and existing function signatures (createNode,
   createStatus, createIconButton, createIconNode, hasStorageArea,
   createMemoryStorageArea, isRecord, hasOwnFields, isNonEmptyString,
   cloneValue) actually match what is currently in those files, not a
   stale assumption baked into the plan.
5. Test-runner fit: confirm every new test file matches this repo's actual
   test command (`npm test` runs `node --test test/*.test.js`) and every
   new code file matches `npm run check`'s glob (`src/*.js`).

Report a numbered list of concrete issues, each with the task number and
the exact text that needs to change — or state plainly that you found none.
```

- [ ] **Step 2: Act on the findings**

If the agent reports zero issues, mark this task complete and proceed to
Task 1.

If it reports issues, fix them directly in
`docs/superpowers/plans/2026-07-12-weather-widget.md` (this file), then
re-run Step 1's exact prompt once more against the corrected plan. Repeat
until a review comes back clean. Do not start Task 1 on an unresolved
finding.

---

### Task 1: `weatherApi.js` — Open-Meteo client

**Files:**
- Create: `src/weatherApi.js`
- Test: `test/weatherApi.test.js`

**Interfaces:**
- Consumes: nothing (no dependency on other new files).
- Produces, for later tasks:
  - `class WeatherApiError extends Error` with a `.details` object property
    (mirrors `DtfApiError` in `src/dtfApi.js`).
  - `async function fetchWeather({ latitude, longitude, fetchImpl })` →
    `Promise<{ temperature: number, uvIndexMax: number, precipitationProbabilityMax: number }>`.
  - `async function fetchAirQuality({ latitude, longitude, fetchImpl })` →
    `Promise<{ europeanAqi: number, pm2_5: number }>`.
  - `async function geocodeCity(name, { fetchImpl })` →
    `Promise<{ name: string, country: string, latitude: number, longitude: number }>`.
  - `function uvIndexLevel(value: number): string` — WHO UV scale label.
  - `function europeanAqiCategory(value: number): string` — European AQI
    band label.

- [ ] **Step 1: Write the failing test file**

Create `test/weatherApi.test.js`:

```js
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  WeatherApiError,
  europeanAqiCategory,
  fetchAirQuality,
  fetchWeather,
  geocodeCity,
  uvIndexLevel
} from "../src/weatherApi.js";

function response(body, init = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    async json() {
      return body;
    }
  };
}

describe("fetchWeather", () => {
  it("requests temperature, UV, and rain probability with the given coordinates", async () => {
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      return response({
        current: { temperature_2m: 24.3 },
        daily: { uv_index_max: [6.1], precipitation_probability_max: [20] }
      });
    };

    const result = await fetchWeather({ latitude: 41.72, longitude: 44.78, fetchImpl });
    const requestedUrl = new URL(calls[0]);

    assert.equal(
      requestedUrl.origin + requestedUrl.pathname,
      "https://api.open-meteo.com/v1/forecast"
    );
    assert.equal(requestedUrl.searchParams.get("latitude"), "41.72");
    assert.equal(requestedUrl.searchParams.get("longitude"), "44.78");
    assert.equal(requestedUrl.searchParams.get("current"), "temperature_2m");
    assert.equal(
      requestedUrl.searchParams.get("daily"),
      "uv_index_max,precipitation_probability_max"
    );
    assert.equal(requestedUrl.searchParams.get("timezone"), "auto");
    assert.deepEqual(result, {
      temperature: 24.3,
      uvIndexMax: 6.1,
      precipitationProbabilityMax: 20
    });
  });

  it("throws WeatherApiError for invalid coordinates", async () => {
    const fetchImpl = async () => {
      throw new Error("fetchImpl should not be called for invalid coordinates");
    };

    await assert.rejects(
      () => fetchWeather({ latitude: Number.NaN, longitude: 44.78, fetchImpl }),
      (error) => error instanceof WeatherApiError && error.details?.fieldName === "latitude"
    );
  });

  it("throws WeatherApiError on non-200 responses", async () => {
    const fetchImpl = async () => response({}, { ok: false, status: 503 });

    await assert.rejects(
      () => fetchWeather({ latitude: 41.72, longitude: 44.78, fetchImpl }),
      (error) => error instanceof WeatherApiError && error.message.includes("503")
    );
  });

  it("throws WeatherApiError when expected fields are missing", async () => {
    const fetchImpl = async () => response({ current: {}, daily: {} });

    await assert.rejects(
      () => fetchWeather({ latitude: 41.72, longitude: 44.78, fetchImpl }),
      (error) => error instanceof WeatherApiError
    );
  });
});

describe("fetchAirQuality", () => {
  it("requests European AQI and PM2.5 with the given coordinates", async () => {
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      return response({ current: { european_aqi: 34, pm2_5: 11.4 } });
    };

    const result = await fetchAirQuality({ latitude: 41.72, longitude: 44.78, fetchImpl });
    const requestedUrl = new URL(calls[0]);

    assert.equal(
      requestedUrl.origin + requestedUrl.pathname,
      "https://air-quality-api.open-meteo.com/v1/air-quality"
    );
    assert.equal(requestedUrl.searchParams.get("latitude"), "41.72");
    assert.equal(requestedUrl.searchParams.get("longitude"), "44.78");
    assert.equal(requestedUrl.searchParams.get("current"), "european_aqi,pm2_5");
    assert.deepEqual(result, { europeanAqi: 34, pm2_5: 11.4 });
  });

  it("throws WeatherApiError on non-200 responses", async () => {
    const fetchImpl = async () => response({}, { ok: false, status: 500 });

    await assert.rejects(
      () => fetchAirQuality({ latitude: 41.72, longitude: 44.78, fetchImpl }),
      (error) => error instanceof WeatherApiError && error.message.includes("500")
    );
  });

  it("throws WeatherApiError when expected fields are missing", async () => {
    const fetchImpl = async () => response({ current: {} });

    await assert.rejects(
      () => fetchAirQuality({ latitude: 41.72, longitude: 44.78, fetchImpl }),
      (error) => error instanceof WeatherApiError
    );
  });
});

describe("geocodeCity", () => {
  it("resolves the first search result to a location", async () => {
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      return response({
        results: [
          { name: "Тбилиси", country: "Georgia", latitude: 41.72, longitude: 44.78 },
          { name: "Тбилисская", country: "Russia", latitude: 45.36, longitude: 40.09 }
        ]
      });
    };

    const result = await geocodeCity("Тбилиси", { fetchImpl });
    const requestedUrl = new URL(calls[0]);

    assert.equal(
      requestedUrl.origin + requestedUrl.pathname,
      "https://geocoding-api.open-meteo.com/v1/search"
    );
    assert.equal(requestedUrl.searchParams.get("name"), "Тбилиси");
    assert.equal(requestedUrl.searchParams.get("count"), "1");
    assert.equal(requestedUrl.searchParams.get("language"), "ru");
    assert.deepEqual(result, {
      name: "Тбилиси",
      country: "Georgia",
      latitude: 41.72,
      longitude: 44.78
    });
  });

  it("throws WeatherApiError when no results are found", async () => {
    const fetchImpl = async () => response({ results: [] });

    await assert.rejects(
      () => geocodeCity("Несуществующийгород", { fetchImpl }),
      (error) => error instanceof WeatherApiError
    );
  });

  it("throws WeatherApiError for an empty city name", async () => {
    const fetchImpl = async () => {
      throw new Error("fetchImpl should not be called for an empty name");
    };

    await assert.rejects(
      () => geocodeCity("   ", { fetchImpl }),
      (error) => error instanceof WeatherApiError
    );
  });

  it("throws WeatherApiError on non-200 responses", async () => {
    const fetchImpl = async () => response({}, { ok: false, status: 429 });

    await assert.rejects(
      () => geocodeCity("Тбилиси", { fetchImpl }),
      (error) => error instanceof WeatherApiError && error.message.includes("429")
    );
  });
});

describe("uvIndexLevel", () => {
  it("maps values to the WHO UV scale", () => {
    assert.equal(uvIndexLevel(0), "Низкий");
    assert.equal(uvIndexLevel(2), "Низкий");
    assert.equal(uvIndexLevel(3), "Умеренный");
    assert.equal(uvIndexLevel(5), "Умеренный");
    assert.equal(uvIndexLevel(6), "Высокий");
    assert.equal(uvIndexLevel(7), "Высокий");
    assert.equal(uvIndexLevel(8), "Очень высокий");
    assert.equal(uvIndexLevel(10), "Очень высокий");
    assert.equal(uvIndexLevel(11), "Экстремальный");
    assert.equal(uvIndexLevel(15), "Экстремальный");
  });
});

describe("europeanAqiCategory", () => {
  it("maps values to European AQI bands", () => {
    assert.equal(europeanAqiCategory(0), "Хорошо");
    assert.equal(europeanAqiCategory(20), "Хорошо");
    assert.equal(europeanAqiCategory(21), "Приемлемо");
    assert.equal(europeanAqiCategory(40), "Приемлемо");
    assert.equal(europeanAqiCategory(41), "Умеренно");
    assert.equal(europeanAqiCategory(60), "Умеренно");
    assert.equal(europeanAqiCategory(61), "Плохо");
    assert.equal(europeanAqiCategory(80), "Плохо");
    assert.equal(europeanAqiCategory(81), "Очень плохо");
    assert.equal(europeanAqiCategory(100), "Очень плохо");
    assert.equal(europeanAqiCategory(101), "Критично");
    assert.equal(europeanAqiCategory(250), "Критично");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/weatherApi.test.js`
Expected: FAIL — `Cannot find module '../src/weatherApi.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/weatherApi.js`:

```js
export class WeatherApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "WeatherApiError";
    this.details = details;
  }
}

const FORECAST_ENDPOINT = "https://api.open-meteo.com/v1/forecast";
const AIR_QUALITY_ENDPOINT = "https://air-quality-api.open-meteo.com/v1/air-quality";
const GEOCODING_ENDPOINT = "https://geocoding-api.open-meteo.com/v1/search";

const UV_INDEX_LEVELS = [
  { max: 2, label: "Низкий" },
  { max: 5, label: "Умеренный" },
  { max: 7, label: "Высокий" },
  { max: 10, label: "Очень высокий" },
  { max: Infinity, label: "Экстремальный" }
];

const EUROPEAN_AQI_CATEGORIES = [
  { max: 20, label: "Хорошо" },
  { max: 40, label: "Приемлемо" },
  { max: 60, label: "Умеренно" },
  { max: 80, label: "Плохо" },
  { max: 100, label: "Очень плохо" },
  { max: Infinity, label: "Критично" }
];

export function uvIndexLevel(value) {
  return (UV_INDEX_LEVELS.find((band) => value <= band.max) ?? UV_INDEX_LEVELS.at(-1)).label;
}

export function europeanAqiCategory(value) {
  return (
    EUROPEAN_AQI_CATEGORIES.find((band) => value <= band.max) ?? EUROPEAN_AQI_CATEGORIES.at(-1)
  ).label;
}

function assertCoordinate(value, fieldName) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new WeatherApiError(`Weather request has invalid ${fieldName}`, {
      fieldName,
      value
    });
  }
}

function assertFiniteField(value, fieldName, context) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new WeatherApiError(`Open-Meteo response is missing ${fieldName}`, {
      fieldName,
      ...context
    });
  }
}

export async function fetchWeather({ latitude, longitude, fetchImpl = globalThis.fetch }) {
  assertCoordinate(latitude, "latitude");
  assertCoordinate(longitude, "longitude");

  const url = new URL(FORECAST_ENDPOINT);
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("current", "temperature_2m");
  url.searchParams.set("daily", "uv_index_max,precipitation_probability_max");
  url.searchParams.set("timezone", "auto");

  const response = await fetchImpl(url.toString());

  if (!response.ok) {
    throw new WeatherApiError(
      `Open-Meteo forecast request failed with status ${response.status}`,
      { status: response.status, url: url.toString() }
    );
  }

  const body = await response.json();
  const temperature = body?.current?.temperature_2m;
  const uvIndexMax = body?.daily?.uv_index_max?.[0];
  const precipitationProbabilityMax = body?.daily?.precipitation_probability_max?.[0];

  assertFiniteField(temperature, "current.temperature_2m", { url: url.toString() });
  assertFiniteField(uvIndexMax, "daily.uv_index_max[0]", { url: url.toString() });
  assertFiniteField(precipitationProbabilityMax, "daily.precipitation_probability_max[0]", {
    url: url.toString()
  });

  return { temperature, uvIndexMax, precipitationProbabilityMax };
}

export async function fetchAirQuality({ latitude, longitude, fetchImpl = globalThis.fetch }) {
  assertCoordinate(latitude, "latitude");
  assertCoordinate(longitude, "longitude");

  const url = new URL(AIR_QUALITY_ENDPOINT);
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("current", "european_aqi,pm2_5");

  const response = await fetchImpl(url.toString());

  if (!response.ok) {
    throw new WeatherApiError(
      `Open-Meteo air quality request failed with status ${response.status}`,
      { status: response.status, url: url.toString() }
    );
  }

  const body = await response.json();
  const europeanAqi = body?.current?.european_aqi;
  const pm2_5 = body?.current?.pm2_5;

  assertFiniteField(europeanAqi, "current.european_aqi", { url: url.toString() });
  assertFiniteField(pm2_5, "current.pm2_5", { url: url.toString() });

  return { europeanAqi, pm2_5 };
}

export async function geocodeCity(name, { fetchImpl = globalThis.fetch } = {}) {
  if (typeof name !== "string" || name.trim() === "") {
    throw new WeatherApiError("City name must not be empty", { name });
  }

  const url = new URL(GEOCODING_ENDPOINT);
  url.searchParams.set("name", name.trim());
  url.searchParams.set("count", "1");
  url.searchParams.set("language", "ru");

  const response = await fetchImpl(url.toString());

  if (!response.ok) {
    throw new WeatherApiError(
      `Open-Meteo geocoding request failed with status ${response.status}`,
      { status: response.status, url: url.toString() }
    );
  }

  const body = await response.json();
  const result = Array.isArray(body?.results) ? body.results[0] : null;

  if (
    !result ||
    typeof result.name !== "string" ||
    result.name.trim() === "" ||
    typeof result.latitude !== "number" ||
    !Number.isFinite(result.latitude) ||
    typeof result.longitude !== "number" ||
    !Number.isFinite(result.longitude)
  ) {
    throw new WeatherApiError(`City "${name}" was not found`, { name });
  }

  return {
    name: result.name,
    country: typeof result.country === "string" ? result.country : "",
    latitude: result.latitude,
    longitude: result.longitude
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/weatherApi.test.js`
Expected: PASS, all `describe` blocks green.

- [ ] **Step 5: Commit**

```bash
git add src/weatherApi.js test/weatherApi.test.js
git commit -m "feat: add weatherApi.js — key-less Open-Meteo client"
```

---

### Task 2: `weatherStore.js` — location + cache persistence

**Files:**
- Create: `src/weatherStore.js`
- Test: `test/weatherStore.test.js`

**Interfaces:**
- Consumes: `isRecord`, `hasOwnFields`, `isNonEmptyString`, `cloneValue`
  from `src/storeUtils.js` (existing); `createMemoryStorageArea` from
  `src/queueStore.js` (existing, test-only).
- Produces, for later tasks:
  - `WEATHER_LOCATION_STORAGE_KEY = "dtfWeatherLocation"`,
    `WEATHER_CACHE_STORAGE_KEY = "dtfWeatherCache"`.
  - `isWeatherLocation(value): boolean`, `isWeatherCache(value): boolean`.
  - `createWeatherLocationStore(storageArea)` →
    `{ getLocation(): Promise<Location|null>, setLocation(location): Promise<Location>, clearLocation(): Promise<void> }`
    where `Location = { version: 1, name, country, latitude, longitude }`.
  - `createWeatherCacheStore(storageArea)` →
    `{ getCache(): Promise<Cache|null>, setCache(cache): Promise<Cache>, clearCache(): Promise<void> }`
    where
    `Cache = { version: 1, locationName, fetchedAt, temperature, uvIndexMax, precipitationProbabilityMax, europeanAqi, pm2_5 }`.

- [ ] **Step 1: Write the failing test file**

Create `test/weatherStore.test.js`:

```js
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
    europeanAqi: 34,
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
    assert.equal(saved.version, 1);

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
});

describe("isWeatherLocation / isWeatherCache", () => {
  it("accepts well-formed values", () => {
    assert.equal(isWeatherLocation({ version: 1, ...location() }), true);
    assert.equal(isWeatherCache({ version: 1, ...cache() }), true);
  });

  it("rejects non-finite coordinates and metrics", () => {
    assert.equal(
      isWeatherLocation({ version: 1, ...location({ latitude: Number.NaN }) }),
      false
    );
    assert.equal(
      isWeatherCache({ version: 1, ...cache({ temperature: Number.NaN }) }),
      false
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/weatherStore.test.js`
Expected: FAIL — `Cannot find module '../src/weatherStore.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/weatherStore.js`:

```js
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/weatherStore.test.js`
Expected: PASS, all `describe` blocks green.

- [ ] **Step 5: Commit**

```bash
git add src/weatherStore.js test/weatherStore.test.js
git commit -m "feat: add weatherStore.js — sync location + local cache persistence"
```

---

### Task 3: `weatherService.js` — orchestration, TTL, force-refetch

**Files:**
- Create: `src/weatherService.js`
- Test: `test/weatherService.test.js`

**Interfaces:**
- Consumes:
  - From Task 1: `fetchWeather`, `fetchAirQuality`, `geocodeCity`,
    `WeatherApiError` (all from `./weatherApi.js`).
  - From Task 2: `createWeatherLocationStore`, `createWeatherCacheStore`
    (test-only, to build a real store over `createMemoryStorageArea()`).
- Produces, for later tasks:
  - `createWeatherService({ locationStore, cacheStore, fetchWeather, fetchAirQuality, geocodeCity, now })`
    → `{ initialize(): Promise<Result>, setCity(name: string): Promise<Result> }`
    where
    `Result = { status: "no-location" | "ready" | "stale" | "error", location: Location|null, data: Cache|null, error: string|null }`.
  - `initialize()` never throws — network/geocoding failures are caught and
    turned into `status: "error"` or `status: "stale"`.
  - `setCity(name)` lets a `geocodeCity` failure (city not found, bad
    response) propagate as a thrown `WeatherApiError` — it does **not**
    persist a location in that case. Failures from the subsequent
    weather/air-quality fetch (after a successful geocode) are caught and
    returned as `status: "error"`, not thrown.

- [ ] **Step 1: Write the failing test file**

Create `test/weatherService.test.js`:

```js
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMemoryStorageArea } from "../src/queueStore.js";
import { createWeatherCacheStore, createWeatherLocationStore } from "../src/weatherStore.js";
import { WeatherApiError } from "../src/weatherApi.js";
import { createWeatherService } from "../src/weatherService.js";

const TBILISI = { name: "Тбилиси", country: "Georgia", latitude: 41.72, longitude: 44.78 };
const WEATHER_READING = { temperature: 24, uvIndexMax: 6.1, precipitationProbabilityMax: 20 };
const AIR_READING = { europeanAqi: 34, pm2_5: 11.4 };

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
    assert.equal(result.data.europeanAqi, 34);
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
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/weatherService.test.js`
Expected: FAIL — `Cannot find module '../src/weatherService.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/weatherService.js`:

```js
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/weatherService.test.js`
Expected: PASS, all `describe` blocks green.

- [ ] **Step 5: Commit**

```bash
git add src/weatherService.js test/weatherService.test.js
git commit -m "feat: add weatherService.js — TTL cache + force-refetch on city change"
```

---

### Task 4: `manifest.json` host permissions

**Files:**
- Modify: `manifest.json`
- Modify: `test/manifest.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: three new `host_permissions` entries that Task 1's
  `fetchWeather`/`fetchAirQuality`/`geocodeCity` need at runtime inside the
  packed/unpacked extension (tests use a fake `fetchImpl` and are
  unaffected by this permission list).

- [ ] **Step 1: Update the failing assertion**

In `test/manifest.test.js`, replace the existing assertion:

```js
    assert.deepEqual(manifest.permissions, ["storage", "favicon"]);
    assert.deepEqual(manifest.host_permissions, ["https://api.dtf.ru/*"]);
```

with:

```js
    assert.deepEqual(manifest.permissions, ["storage", "favicon"]);
    assert.deepEqual(manifest.host_permissions, [
      "https://api.dtf.ru/*",
      "https://api.open-meteo.com/*",
      "https://air-quality-api.open-meteo.com/*",
      "https://geocoding-api.open-meteo.com/*"
    ]);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/manifest.test.js`
Expected: FAIL — `host_permissions` mismatch (manifest still only has
`api.dtf.ru`).

- [ ] **Step 3: Update `manifest.json`**

Replace the `"host_permissions"` line in `manifest.json`:

```json
  "host_permissions": ["https://api.dtf.ru/*"],
```

with:

```json
  "host_permissions": [
    "https://api.dtf.ru/*",
    "https://api.open-meteo.com/*",
    "https://air-quality-api.open-meteo.com/*",
    "https://geocoding-api.open-meteo.com/*"
  ],
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/manifest.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add manifest.json test/manifest.test.js
git commit -m "feat: add Open-Meteo host permissions for the weather widget"
```

---

### Task 5: `weatherUiState.js` — city-form open/closed state

Note on ordering: the spec's "Рекомендуемый порядок реализации" lists this
after the minimal UI. This plan builds it first instead, because Task 6's
UI wiring consumes `isEditingCity`/`startEditingCity`/`stopEditingCity`
directly (the edit-city affordance is part of the initial wiring here, not
a later addition) — the spec's order is a recommendation, not a
dependency-ordering requirement, and this plan's Task 1→2→3→4→5→6→7→8
sequence is the one that keeps every "Consumes" satisfied by an earlier
"Produces".

**Files:**
- Create: `src/weatherUiState.js`
- Test: `test/weatherUiState.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces, for Task 6:
  - `createInitialWeatherUiState()` → `{ editing: boolean }`.
  - `startEditingCity(state)` → same shape, `editing: true`.
  - `stopEditingCity(state)` → same shape, `editing: false`.
  - `isEditingCity(state)` → `boolean`.

- [ ] **Step 1: Write the failing test file**

Create `test/weatherUiState.test.js`:

```js
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createInitialWeatherUiState,
  isEditingCity,
  startEditingCity,
  stopEditingCity
} from "../src/weatherUiState.js";

describe("weatherUiState", () => {
  it("starts not editing", () => {
    assert.equal(isEditingCity(createInitialWeatherUiState()), false);
  });

  it("starts and stops editing the city", () => {
    let state = createInitialWeatherUiState();
    state = startEditingCity(state);
    assert.equal(isEditingCity(state), true);

    state = stopEditingCity(state);
    assert.equal(isEditingCity(state), false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/weatherUiState.test.js`
Expected: FAIL — `Cannot find module '../src/weatherUiState.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/weatherUiState.js`:

```js
// Pure UI-state machine for the weather panel's city form: one flag,
// whether the form is open over an already-configured city. Unlike
// favoritesUiState there is no add/edit distinction — the same form covers
// first-time setup and later city changes.

export function createInitialWeatherUiState() {
  return { editing: false };
}

export function startEditingCity() {
  return { editing: true };
}

export function stopEditingCity() {
  return { editing: false };
}

export function isEditingCity(state) {
  return state.editing === true;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/weatherUiState.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/weatherUiState.js test/weatherUiState.test.js
git commit -m "feat: add weatherUiState.js — city-form open/closed state"
```

---

### Task 6: Wire the weather panel into `newtab.html` / `newtab.js`

**Files:**
- Modify: `src/newtab.html`
- Modify: `src/newtab.js`
- Test: `test/weatherSource.test.js`

**Interfaces:**
- Consumes:
  - From Task 1: `europeanAqiCategory`, `uvIndexLevel` (`./weatherApi.js`).
  - From Task 3: `createWeatherService` (`./weatherService.js`), and the
    `Result` shape `{ status, location, data, error }`.
  - From Task 5: `createInitialWeatherUiState`, `isEditingCity`,
    `startEditingCity`, `stopEditingCity` (`./weatherUiState.js`).
  - From Task 2 (indirectly through `newtab.js`):
    `createWeatherLocationStore`, `createWeatherCacheStore`
    (`./weatherStore.js`).
  - Existing `newtab.js` helpers, unchanged:
    `createNode(tagName, className, textContent)`,
    `createStatus(text, { error, live })`,
    `createIconButton(className, text, iconName)`, `createIconNode(name)`
    (from `./icons.js`), `hasStorageArea(area)`, `localStorageArea`,
    `syncStorageArea`.
- Produces: a live `#weather` section, independent of `#app` and
  `#favorites`; no other task depends on this one.

- [ ] **Step 1: Write the failing source-assertion test file**

Create `test/weatherSource.test.js`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

async function source() {
  return readFile(new URL("../src/newtab.js", import.meta.url), "utf8");
}

async function html() {
  return readFile(new URL("../src/newtab.html", import.meta.url), "utf8");
}

async function css() {
  return readFile(new URL("../src/newtab.css", import.meta.url), "utf8");
}

describe("newtab weather source", () => {
  it("renders the weather panel into its own root, independent of #app", async () => {
    const code = await source();
    assert.match(code, /querySelector\("#weather"\)/);
    assert.match(code, /if \(weatherRoot\) \{/);
    assert.match(code, /if \(app\) \{/);
  });

  it("wires weatherApi/weatherStore/weatherService/weatherUiState modules", async () => {
    const code = await source();
    assert.match(code, /from "\.\/weatherUiState\.js"/);
    assert.match(code, /from "\.\/weatherApi\.js"/);
    assert.match(code, /from "\.\/weatherService\.js"/);
    assert.match(code, /from "\.\/weatherStore\.js"/);
  });

  it("initializes weather independently of the queue and favorites boot", async () => {
    const code = await source();
    assert.match(code, /weatherResult = await weatherService\.initialize\(\);/);
  });

  it("submits the city form through setCity and keeps the form open on error", async () => {
    const code = await source();
    assert.match(code, /form\.dataset\.weatherForm !== "city"/);
    assert.match(code, /await weatherService\.setCity\(cityName\)/);
    assert.match(code, /weatherFormError = error instanceof Error/);
  });

  it("supports editing and cancelling the city via data-weather-action", async () => {
    const code = await source();
    assert.match(code, /"edit-city"/);
    assert.match(code, /"cancel-edit-city"/);
    assert.match(code, /startEditingCity\(weatherUi\)/);
    assert.match(code, /stopEditingCity\(weatherUi\)/);
  });

  it("blocks weather actions while a request is in flight", async () => {
    const code = await source();
    assert.match(code, /let weatherBusy = false;/);
    assert.match(code, /\|\| weatherBusy\)\s*\{\s*return;/);
  });

  it("renders the weather panel below the news card in newtab.html", async () => {
    const markup = await html();
    assert.match(markup, /<section class="panel" id="app">/);
    assert.match(markup, /<section class="panel weather-panel" id="weather">/);
    const appIndex = markup.indexOf('id="app"');
    const weatherIndex = markup.indexOf('id="weather"');
    assert.ok(appIndex > -1 && weatherIndex > -1 && appIndex < weatherIndex);
  });

  it("styles the metrics row as a grid in newtab.css", async () => {
    const styles = await css();
    assert.match(styles, /\.weather-metrics\s*\{[^}]*display: grid;/s);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/weatherSource.test.js`
Expected: FAIL on every assertion — none of this wiring exists yet.

- [ ] **Step 3: Add the weather section to `src/newtab.html`**

Find this exact block:

```html
    <main class="page" aria-live="polite" aria-atomic="true">
      <section class="panel" id="app">
        <h1 class="title">Загружаю новость...</h1>
      </section>
    </main>
```

Replace it with:

```html
    <main class="page" aria-live="polite" aria-atomic="true">
      <section class="panel" id="app">
        <h1 class="title">Загружаю новость...</h1>
      </section>
      <section class="panel weather-panel" id="weather">
        <h2 class="title">Загружаю погоду...</h2>
      </section>
    </main>
```

- [ ] **Step 4: Add imports and the `#weather` root query to `src/newtab.js`**

Find this exact block (top of the file):

```js
import { fetchNews } from "./dtfApi.js";
import { createQueueService } from "./queueService.js";
import { createInitialState, createQueueStore } from "./queueStore.js";

const app = document.querySelector("#app");
const favoritesRoot = document.querySelector("#favorites");
const favoritesPanelRoot = document.querySelector("#favorites-panel");
```

Replace it with:

```js
import { fetchNews } from "./dtfApi.js";
import { createQueueService } from "./queueService.js";
import { createInitialState, createQueueStore } from "./queueStore.js";
import { europeanAqiCategory, uvIndexLevel } from "./weatherApi.js";
import { createWeatherService } from "./weatherService.js";
import { createWeatherCacheStore, createWeatherLocationStore } from "./weatherStore.js";
import {
  createInitialWeatherUiState,
  isEditingCity,
  startEditingCity,
  stopEditingCity
} from "./weatherUiState.js";

const app = document.querySelector("#app");
const favoritesRoot = document.querySelector("#favorites");
const favoritesPanelRoot = document.querySelector("#favorites-panel");
const weatherRoot = document.querySelector("#weather");
```

- [ ] **Step 5: Construct the weather store/service in `src/newtab.js`**

Find this exact block (right after the existing `service` construction):

```js
const service = hasStorageArea(localStorageArea)
  ? createQueueService({
      store: createQueueStore(localStorageArea),
      fetchNews,
      openUrl(url) {
        const tabs = globalThis.chrome?.tabs;

        if (!tabs || typeof tabs.create !== "function") {
          throw new Error("Недоступен chrome.tabs.create");
        }

        return tabs.create({ url });
      }
    })
  : createUnavailableService("Недоступны API Chrome.");

let currentResult = null;
```

Replace it with:

```js
const service = hasStorageArea(localStorageArea)
  ? createQueueService({
      store: createQueueStore(localStorageArea),
      fetchNews,
      openUrl(url) {
        const tabs = globalThis.chrome?.tabs;

        if (!tabs || typeof tabs.create !== "function") {
          throw new Error("Недоступен chrome.tabs.create");
        }

        return tabs.create({ url });
      }
    })
  : createUnavailableService("Недоступны API Chrome.");

const weatherLocationStore = hasStorageArea(syncStorageArea)
  ? createWeatherLocationStore(syncStorageArea)
  : null;
const weatherCacheStore = hasStorageArea(localStorageArea)
  ? createWeatherCacheStore(localStorageArea)
  : null;
const weatherService =
  weatherLocationStore && weatherCacheStore
    ? createWeatherService({
        locationStore: weatherLocationStore,
        cacheStore: weatherCacheStore
      })
    : null;

let currentResult = null;
```

- [ ] **Step 6: Add weather state variables in `src/newtab.js`**

Find this exact block:

```js
let favoritesGeneration = 0;
let pendingGearFocus = false;
```

Replace it with:

```js
let favoritesGeneration = 0;
let pendingGearFocus = false;
let weatherResult = null;
let weatherUi = createInitialWeatherUiState();
let weatherFormError = "";
let weatherBusy = false;
```

- [ ] **Step 7: Add the weather panel block in `src/newtab.js`**

Find this exact block (the boundary between the favorites IIFE and the
queue/app IIFE):

```js
    })();
  });
}

if (app) {
```

Replace it with (note the new `if (weatherRoot) { ... }` block inserted
between the two, followed by the original `if (app) {`):

```js
    })();
  });
}

if (weatherRoot) {
  function createWeatherForm(location) {
    const form = createNode("form", "weather-form");
    form.dataset.weatherForm = "city";

    const input = createNode("input", "favorite-input");
    input.name = "city";
    input.type = "text";
    input.placeholder = "Город";
    input.value = location ? location.name : "";
    input.required = true;
    input.autocomplete = "off";
    input.disabled = weatherBusy;

    const row = createNode("div", "weather-form__row");
    row.appendChild(input);

    const save = createIconButton("button button--primary", "Сохранить", "check");
    save.type = "submit";
    save.disabled = weatherBusy;
    row.appendChild(save);

    if (location) {
      const cancel = createIconButton("button", "Отмена", "x");
      cancel.type = "button";
      cancel.dataset.weatherAction = "cancel-edit-city";
      cancel.disabled = weatherBusy;
      row.appendChild(cancel);
    }

    form.appendChild(row);
    return form;
  }

  function weatherMetricNode(label, value) {
    const metric = createNode("div", "weather-metric");
    metric.appendChild(createNode("span", "weather-metric__value", value));
    metric.appendChild(createNode("span", "weather-metric__label", label));
    return metric;
  }

  function renderWeatherMetrics(data) {
    const metrics = createNode("div", "weather-metrics");
    metrics.append(
      weatherMetricNode("Температура", `${Math.round(data.temperature)}°`),
      weatherMetricNode(
        "УФ-индекс",
        `${data.uvIndexMax} · ${uvIndexLevel(data.uvIndexMax)}`
      ),
      weatherMetricNode("Дождь сегодня", `${Math.round(data.precipitationProbabilityMax)}%`),
      weatherMetricNode(
        "Воздух",
        `${europeanAqiCategory(data.europeanAqi)} · PM2.5 ${data.pm2_5}`
      )
    );
    return metrics;
  }

  function renderWeather() {
    const fragment = document.createDocumentFragment();

    if (!weatherService) {
      fragment.appendChild(createNode("h2", "title", "Погода"));
      fragment.appendChild(
        createStatus("Недоступны API Chrome для погоды.", {
          error: true,
          live: "assertive"
        })
      );
      weatherRoot.replaceChildren(fragment);
      return;
    }

    const location = weatherResult?.location ?? null;
    const showForm = !location || isEditingCity(weatherUi);

    if (showForm) {
      fragment.appendChild(
        createNode("h2", "title", location ? location.name : "Укажите город")
      );
      fragment.appendChild(createWeatherForm(location));

      if (weatherFormError) {
        fragment.appendChild(
          createStatus(weatherFormError, { error: true, live: "assertive" })
        );
      }

      weatherRoot.replaceChildren(fragment);
      return;
    }

    const { status, data, error } = weatherResult;

    const heading = createNode("div", "weather-heading");
    heading.appendChild(createNode("h2", "title", location.name));

    const editButton = createNode("button", "icon-button");
    editButton.type = "button";
    editButton.dataset.weatherAction = "edit-city";
    editButton.setAttribute("aria-label", "Изменить город");
    editButton.appendChild(createIconNode("pencil"));
    heading.appendChild(editButton);

    fragment.appendChild(heading);

    if (status === "ready" || status === "stale") {
      fragment.appendChild(renderWeatherMetrics(data));
    }

    if (status === "stale") {
      fragment.appendChild(createStatus("Не удалось обновить"));
    }

    if (status === "error") {
      fragment.appendChild(createStatus(error, { error: true, live: "assertive" }));
    }

    weatherRoot.replaceChildren(fragment);
  }

  void (async () => {
    if (!weatherService) {
      renderWeather();
      return;
    }

    try {
      weatherResult = await weatherService.initialize();
    } catch (error) {
      weatherResult = {
        status: "error",
        location: null,
        data: null,
        error: error instanceof Error ? error.message : String(error)
      };
    }

    renderWeather();
  })();

  weatherRoot.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }

    const target = event.target.closest("[data-weather-action]");

    if (!(target instanceof HTMLElement) || weatherBusy) {
      return;
    }

    const action = target.dataset.weatherAction;

    if (action === "edit-city") {
      weatherUi = startEditingCity(weatherUi);
      weatherFormError = "";
      renderWeather();
    } else if (action === "cancel-edit-city") {
      weatherUi = stopEditingCity(weatherUi);
      weatherFormError = "";
      renderWeather();
    }
  });

  weatherRoot.addEventListener("submit", (event) => {
    const form = event.target;

    if (!(form instanceof HTMLFormElement) || form.dataset.weatherForm !== "city") {
      return;
    }

    event.preventDefault();

    if (weatherBusy || !weatherService) {
      return;
    }

    const cityName = String(new FormData(form).get("city") ?? "").trim();

    if (!cityName) {
      return;
    }

    weatherBusy = true;
    renderWeather();

    void (async () => {
      try {
        weatherResult = await weatherService.setCity(cityName);
        weatherUi = stopEditingCity(weatherUi);
        weatherFormError = "";
      } catch (error) {
        weatherFormError = error instanceof Error ? error.message : String(error);
      } finally {
        weatherBusy = false;
        renderWeather();
      }
    })();
  });
}

if (app) {
```

Note: the pencil ("Изменить город") button doubles as the only retry
affordance for an `error` state with a location already set — resubmitting
the same city name re-runs `setCity`, which always force-fetches. No
separate retry button is needed (matches the spec's non-goal of no
background polling).

- [ ] **Step 8: Run the test to verify it passes**

Run: `node --test test/weatherSource.test.js`
Expected: PASS (the CSS assertion will still fail until Task 7 — see next
step).

- [ ] **Step 9: Run the full test suite and the syntax check**

Run: `npm test`
Expected: every existing suite still passes; `weatherSource.test.js`'s CSS
assertion (`.weather-metrics { display: grid; }`) is the one known failure
until Task 7 lands — confirm it is the *only* failure.

Run: `npm run check`
Expected: clean (no syntax errors) across all of `src/*.js`.

- [ ] **Step 10: Commit**

```bash
git add src/newtab.html src/newtab.js test/weatherSource.test.js
git commit -m "feat: wire the weather panel into newtab.html/newtab.js"
```

---

### Task 7: `newtab.css` — weather panel styling

**Files:**
- Modify: `src/newtab.css`

**Interfaces:**
- Consumes: class names introduced in Task 6 —
  `.weather-panel` (unstyled hook, inherits `.panel`), `.weather-heading`,
  `.weather-metrics`, `.weather-metric`, `.weather-metric__value`,
  `.weather-metric__label`, `.weather-form__row`.
- Produces: nothing consumed by later tasks; this is the last styling pass.

- [ ] **Step 1: Add the weather rules**

Find this exact block:

```css
.status--error {
  color: var(--danger);
}

@media (max-width: 600px) {
```

Replace it with:

```css
.status--error {
  color: var(--danger);
}

.weather-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.weather-metrics {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}

.weather-metric {
  display: grid;
  gap: 2px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
}

.weather-metric__value {
  font-size: 17px;
  font-weight: 700;
}

.weather-metric__label {
  font-size: 12px;
  color: var(--muted);
}

.weather-form__row {
  display: flex;
  gap: 10px;
}

.weather-form__row > .favorite-input {
  flex: 1;
  min-width: 0;
}

@media (max-width: 600px) {
```

- [ ] **Step 2: Add the narrow-viewport override**

Find this exact block (inside the same `@media (max-width: 600px)` rule,
already present in the file):

```css
  .actions,
  .favorite-form {
    flex-direction: column;
  }

  .button,
  .favorite-input {
    width: 100%;
  }
}
```

Replace it with:

```css
  .actions,
  .favorite-form {
    flex-direction: column;
  }

  .button,
  .favorite-input {
    width: 100%;
  }

  .weather-metrics {
    grid-template-columns: repeat(2, 1fr);
  }

  .weather-form__row {
    flex-direction: column;
  }
}
```

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: PASS, including the previously-failing CSS assertion in
`weatherSource.test.js`.

Run: `npm run check`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/newtab.css
git commit -m "style: add weather panel, metrics grid, and form layout"
```

---

### Task 8: Manual verification + CHANGELOG entry

**Files:**
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: the fully working feature from Tasks 1–7.
- Produces: nothing further consumed by other tasks — this is the final
  task.

**Important — automation constraint:** this repo's new-tab page is a
`chrome_url_overrides` page. Prior sessions established that it is
sandboxed from browser-automation tooling (Chrome DevTools MCP / Playwright
cannot drive it) — verification of live behavior has to be done by the
human user through `chrome://extensions` → "Load unpacked" and manual
clicking, or by asking the user to paste back what they see / what a
DevTools console snippet returns. Do not attempt to script this step with
browser automation; ask the user to perform it and report results.

- [ ] **Step 1: Run the automated gate one more time**

Run: `npm test && npm run check`
Expected: everything green. This must pass before asking the user to do
any manual testing.

- [ ] **Step 2: Ask the user to load and manually verify the extension**

Ask the user to:

1. Open `chrome://extensions`, enable Developer mode, "Load unpacked", and
   select this repo's root directory (or "Reload" if already loaded).
2. Open a new tab. Confirm the weather panel renders below the news card
   showing "Укажите город" with a text input.
3. Type a real city (e.g. "Тбилиси"), submit. Confirm four metrics render:
   temperature, UV index + level, rain probability, air quality + PM2.5.
4. Open another new tab within 30 minutes. Confirm the same numbers render
   instantly — in DevTools → Network, confirm no new request to
   `open-meteo.com` fired (served from `chrome.storage.local` cache).
5. Click the pencil next to the city name, enter a different city, submit.
   Confirm the panel updates to the new city's numbers, and DevTools →
   Network shows fresh requests to all three Open-Meteo hosts.
6. In DevTools → Application → Storage → Extension Storage, confirm
   `dtfWeatherLocation` is under **Sync** storage and `dtfWeatherCache` is
   under **Local** storage.
7. Delete the `dtfWeatherCache` key via DevTools, then block
   `*.open-meteo.com` under DevTools → Network → request blocking, and
   reload the tab. Confirm the panel shows an error status (not a blank
   panel) and the news card above still works normally.
8. Unblock the network, reload. Confirm the panel recovers on its own.
9. On `chrome://extensions` → this extension → Details → Permissions,
   confirm the three new Open-Meteo hosts are listed.

Wait for the user's report before proceeding. If anything in steps 2–9
doesn't match, treat it as a bug: reproduce with a targeted test (extend
the relevant `test/weather*.test.js` file) before patching — don't patch
blind.

- [ ] **Step 3: Add the CHANGELOG entry**

Find this exact block in `CHANGELOG.md`:

```markdown
## [Unreleased]

### Added

- Favorites now sync across devices via `chrome.storage.sync`: they follow
```

Replace it with:

```markdown
## [Unreleased]

### Added

- A weather panel now renders below the news card: current temperature, UV
  index (with a WHO-scale level label), today's rain probability, and
  European Air Quality Index with PM2.5 — all sourced from Open-Meteo's
  key-less API, so no secret is embedded in this public client-side
  extension. The city is entered once and stored in `chrome.storage.sync`
  (`dtfWeatherLocation`), following you across devices the same way
  favorites do; the reading itself is cached in `chrome.storage.local`
  (`dtfWeatherCache`) for 30 minutes to avoid refetching on every new tab.
- `manifest.json` `host_permissions` now also cover `api.open-meteo.com`,
  `air-quality-api.open-meteo.com`, and `geocoding-api.open-meteo.com` —
  existing installs will see Chrome's "this extension has new
  capabilities" prompt on next update.
- Favorites now sync across devices via `chrome.storage.sync`: they follow
```

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: log the weather widget in the changelog"
```

---

## Execution Handoff

Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task
   (starting with Task 0's plan review), review between tasks, fast
   iteration. Tasks are ordered by dependency (mostly linear: 1→3, 2→3,
   1+3+5→6, 6→7, everything→8), so this mainly buys per-task isolation and
   a review gate, not parallel fan-out — that is still the right fit here.
2. **Inline Execution** — execute tasks in one session using
   `executing-plans`, batch execution with checkpoints for review.
