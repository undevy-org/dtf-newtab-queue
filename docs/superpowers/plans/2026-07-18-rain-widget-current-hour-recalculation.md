# Rain Widget Current-Hour Recalculation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the rain tile from showing a stale, already-elapsed probability and start hour once that rain window has passed — recalculate both against the current hour instead of the whole day.

**Architecture:** `summarizeHourlyForecast` (`src/weatherApi.js:88-134`) currently computes `precipitationProbabilityMax`/`precipitationStartHour` across *all* 24 hourly buckets of "today" with no notion of "now". That is the confirmed root cause of the reported bug: at 06:42 with a rain peak of 90% that happened around midnight and nothing more expected, the tile still showed "90%, ожидается с 00:00" — the day-wide max and the first hour (scanning from 00:00) that crossed the 30% threshold, both already in the past.

The fix anchors the calculation to Open-Meteo's `current.time` field. This field is returned automatically in `body.current.time` whenever any `current=` variable is requested — confirmed against the Open-Meteo docs ("time specifies the moment at which the [current] data is valid") — and is expressed in the same resolved `timezone=auto` local timezone as `hourly.time`, so no new URL parameter is needed and it is safe against a browser/city timezone mismatch (unlike using the browser's own clock). `fetchWeather` extracts and validates `current.time` the same way it already validates `current.temperature_2m`/`current.uv_index`, rounds it down to its hour bucket, and threads it through to `summarizeHourlyForecast`, which now only considers hourly buckets from that hour onward. If no more rain is expected for the rest of today, `precipitationProbabilityMax` becomes `0` and `precipitationStartHour` becomes `null` — the tile naturally goes neutral, exactly like a rain-free day today.

No new persisted field is added — only the *inputs* to an existing calculation change — so `WEATHER_CACHE_VERSION` in `src/weatherStore.js` stays at `3`, and `weatherService.js`/`newtab.js` need no changes (verified by reading both: `fetchWeather`'s return shape and `weatherService.js`'s cached-field list are untouched).

This plan was written directly from a root-cause investigation (no separate spec doc — the fix is a single, well-scoped calculation change, not a new feature).

**Tech Stack:** Vanilla ES modules, no bundler. Tests via Node's built-in `node --test` (`npm test`), syntax gate via `npm run check`. Repo: `dtf-newtab-queue`. Node version installed: v20.19.5 (`node --test-name-pattern` is supported).

## Global Constraints

- No API key anywhere in the code — Open-Meteo's key-less endpoints only (already true, not touched by this change).
- No new `host_permissions`, no new Open-Meteo URL parameter. The existing `current=temperature_2m,uv_index` URL param (`src/weatherApi.js:151`) is unchanged; `current.time` arrives automatically.
- No cache-schema version bump — `WEATHER_CACHE_VERSION` in `src/weatherStore.js` stays at `3`. This fix changes how two already-cached fields (`precipitationProbabilityMax`, `precipitationStartHour`) are *computed*; it does not add or rename any persisted field.
- All user-facing copy (tooltip strings in `src/newtab.js`) is unchanged — this is a data-correctness fix, not a copy change.
- Every touched `src/*.js` file must keep passing `npm run check` (`node --check`); every behavior change must be covered by `npm test` (Node's built-in `node --test`, globbed from `test/*.test.js`).
- Follow the existing validation style in `src/weatherApi.js`: a small `assert*` helper that throws `WeatherApiError` with a `fieldName` detail, mirroring `assertFiniteField`.
- Weather data is still cached for 30 minutes (`WEATHER_CACHE_TTL_MS` in `src/weatherService.js`, unchanged) — the tile can lag "now" by up to that window, same as every other metric in the panel today. This plan does not touch cache TTL.

## File Structure

No new files. Three existing files change, all in one task (see the task's "why one task, not two" note):

- `src/weatherApi.js` — owns the Open-Meteo fetch (`fetchWeather`) and the pure calculation (`summarizeHourlyForecast`). Both the new `assertLocalTimestamp` helper and the current-hour filtering logic live here.
- `test/weatherApi.test.js` — unit tests for `summarizeHourlyForecast` and integration tests for `fetchWeather`.
- `CHANGELOG.md` — one new bullet under `## [Unreleased]` → `### Changed`.

---

### Task 1: Recalculate today's rain probability against the current hour

**Files:**
- Modify: `src/weatherApi.js:47-54` (add `assertLocalTimestamp` next to `assertFiniteField`)
- Modify: `src/weatherApi.js:88-134` (`summarizeHourlyForecast`)
- Modify: `src/weatherApi.js:144-228` (`fetchWeather`)
- Test: `test/weatherApi.test.js:23-197` (`describe("fetchWeather", ...)`)
- Test: `test/weatherApi.test.js:199-261` (`describe("summarizeHourlyForecast", ...)`)
- Modify: `CHANGELOG.md` (`## [Unreleased]` → `### Changed`)

**Interfaces:**
- Consumes: Open-Meteo's `current.time` field (see Architecture above — no new URL param).
- Produces: `summarizeHourlyForecast({ today, time, temperatures, probabilities, currentTime })` — `currentTime` is a new **required** param, a local ISO string `"YYYY-MM-DDTHH:MM"` in the same format as entries in `time`. This function does not itself validate `currentTime`'s format (matching the existing lack of validation on `today` — the caller, `fetchWeather`, validates before calling). `fetchWeather`'s public return shape is unchanged: `{ temperature, temperatureTodayAt15, temperatureYesterdayAt15, uvIndex, uvIndexMax, precipitationProbabilityMax, precipitationStartHour }`.

> **Why one task, not two:** the pure-function filter and the `fetchWeather` wiring are one atomic unit of behavior. `summarizeHourlyForecast` unconditionally reads `currentTime.slice(...)`, so a commit that adds the filter without also wiring `fetchWeather` to supply `currentTime` would make every real `fetchWeather()` call throw `TypeError`. Both TDD cycles below (Phase A: pure function, Phase B: integration) run to green before the single commit at the end, so the repo is never left in a broken state between commits.

#### Phase A — `summarizeHourlyForecast` filtering

- [ ] **Step 1: Write the failing tests**

Replace the entire `describe("summarizeHourlyForecast", ...)` block (`test/weatherApi.test.js:199-261`) with:

```js
describe("summarizeHourlyForecast", () => {
  const validHourlyForecast = {
    today: "2026-07-13",
    currentTime: "2026-07-13T00:00",
    time: [
      "2026-07-12T15:00",
      "2026-07-13T00:00",
      "2026-07-13T15:00",
      "2026-07-13T17:00"
    ],
    temperatures: [29, 22, 27, 26],
    probabilities: [0, 0, 0, 30]
  };

  it("throws WeatherApiError when either local 15:00 timestamp is missing", () => {
    assert.throws(
      () =>
        summarizeHourlyForecast({
          ...validHourlyForecast,
          time: validHourlyForecast.time.slice(1),
          temperatures: validHourlyForecast.temperatures.slice(1),
          probabilities: validHourlyForecast.probabilities.slice(1)
        }),
      WeatherApiError
    );
    assert.throws(
      () =>
        summarizeHourlyForecast({
          ...validHourlyForecast,
          time: validHourlyForecast.time.filter((timestamp) => timestamp !== "2026-07-13T15:00"),
          temperatures: validHourlyForecast.temperatures.slice(0, -1),
          probabilities: validHourlyForecast.probabilities.slice(0, -1)
        }),
      WeatherApiError
    );
  });

  it("throws WeatherApiError when either local 15:00 temperature is undefined or non-finite", () => {
    for (const [index, value] of [
      [0, undefined],
      [0, Number.NaN],
      [2, undefined],
      [2, Number.POSITIVE_INFINITY]
    ]) {
      const temperatures = [...validHourlyForecast.temperatures];
      temperatures[index] = value;

      assert.throws(
        () => summarizeHourlyForecast({ ...validHourlyForecast, temperatures }),
        WeatherApiError
      );
    }
  });

  it("throws WeatherApiError when a current-day precipitation probability is non-finite", () => {
    const probabilities = [...validHourlyForecast.probabilities];
    probabilities[1] = Number.NaN;

    assert.throws(
      () => summarizeHourlyForecast({ ...validHourlyForecast, probabilities }),
      WeatherApiError
    );
  });

  it("excludes hours before the current hour from precipitation calculations", () => {
    const result = summarizeHourlyForecast({
      ...validHourlyForecast,
      currentTime: "2026-07-13T15:00",
      probabilities: [0, 90, 0, 0]
    });

    assert.equal(result.precipitationProbabilityMax, 0);
    assert.equal(result.precipitationStartHour, null);
  });

  it("keeps a later rain window that has not started yet", () => {
    const result = summarizeHourlyForecast({
      ...validHourlyForecast,
      currentTime: "2026-07-13T15:00",
      probabilities: [0, 90, 10, 80]
    });

    assert.equal(result.precipitationProbabilityMax, 80);
    assert.equal(result.precipitationStartHour, "17:00");
  });

  it("treats the current hour itself as the earliest possible start", () => {
    const result = summarizeHourlyForecast({
      ...validHourlyForecast,
      currentTime: "2026-07-13T15:00",
      probabilities: [0, 50, 60, 0]
    });

    assert.equal(result.precipitationProbabilityMax, 60);
    assert.equal(result.precipitationStartHour, "15:00");
  });

  it("rounds the current timestamp down to its hour bucket", () => {
    const result = summarizeHourlyForecast({
      ...validHourlyForecast,
      currentTime: "2026-07-13T15:45",
      probabilities: [0, 70, 60, 0]
    });

    assert.equal(result.precipitationProbabilityMax, 60);
    assert.equal(result.precipitationStartHour, "15:00");
  });

  it("ignores non-finite probabilities for hours that have already passed", () => {
    const result = summarizeHourlyForecast({
      ...validHourlyForecast,
      currentTime: "2026-07-13T15:00",
      probabilities: [0, Number.NaN, 0, 40]
    });

    assert.equal(result.precipitationProbabilityMax, 40);
    assert.equal(result.precipitationStartHour, "17:00");
  });

  it("defaults to zero probability when no hourly buckets remain for today", () => {
    const result = summarizeHourlyForecast({
      ...validHourlyForecast,
      currentTime: "2026-07-13T19:00"
    });

    assert.equal(result.precipitationProbabilityMax, 0);
    assert.equal(result.precipitationStartHour, null);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test --test-name-pattern="summarizeHourlyForecast" test/weatherApi.test.js`

Expected: `# tests 9`, `# pass 3`, `# fail 6`. The 3 original tests (timestamp missing, temperature non-finite, current-day probability non-finite) still pass unchanged — `currentTime` is an inert extra property until the implementation reads it. The 6 new tests fail against the unmodified whole-day calculation:
- "excludes hours before the current hour..." — gets `(90, "00:00")` instead of `(0, null)`.
- "keeps a later rain window..." — gets `(90, "00:00")` instead of `(80, "17:00")`.
- "treats the current hour itself..." — gets `(60, "00:00")` instead of `(60, "15:00")` (startHour mismatch).
- "rounds the current timestamp down..." — gets `(70, "00:00")` instead of `(60, "15:00")`.
- "ignores non-finite probabilities for hours that have already passed" — throws `WeatherApiError` synchronously (the old code validates every hour of today unconditionally, including the already-passed `NaN` one), so the test errors out instead of returning a result.
- "defaults to zero probability when no hourly buckets remain..." — gets `(30, "17:00")` instead of `(0, null)`.

- [ ] **Step 3: Implement the minimal filtering logic**

Replace `summarizeHourlyForecast` (`src/weatherApi.js:88-134`) with:

```js
export function summarizeHourlyForecast({ today, time, temperatures, probabilities, currentTime }) {
  const yesterday = previousLocalDate(today);
  const todayAt15 = `${today}T15:00`;
  const yesterdayAt15 = `${yesterday}T15:00`;
  const todayAt15Index = hourlyTimestampIndex(time, todayAt15);
  const yesterdayAt15Index = hourlyTimestampIndex(time, yesterdayAt15);
  const temperatureTodayAt15 = Array.isArray(temperatures)
    ? temperatures[todayAt15Index]
    : undefined;
  const temperatureYesterdayAt15 = Array.isArray(temperatures)
    ? temperatures[yesterdayAt15Index]
    : undefined;

  assertFiniteField(temperatureTodayAt15, "hourly.temperature_2m at local 15:00", {
    timestamp: todayAt15
  });
  assertFiniteField(temperatureYesterdayAt15, "hourly.temperature_2m at local 15:00", {
    timestamp: yesterdayAt15
  });

  const currentHourTimestamp = `${currentTime.slice(0, 13)}:00`;

  const remainingHoursToday = (Array.isArray(time) ? time : [])
    .map((timestamp, index) => ({
      timestamp,
      probability: Array.isArray(probabilities) ? probabilities[index] : undefined
    }))
    .filter(
      ({ timestamp }) =>
        typeof timestamp === "string" &&
        timestamp.startsWith(`${today}T`) &&
        timestamp >= currentHourTimestamp
    );

  for (const { timestamp, probability } of remainingHoursToday) {
    assertFiniteField(probability, "hourly.precipitation_probability", { timestamp });
  }

  const precipitationProbabilityMax =
    remainingHoursToday.length > 0
      ? Math.max(...remainingHoursToday.map(({ probability }) => probability))
      : 0;
  const precipitationStartHour =
    remainingHoursToday.find(({ probability }) => probability >= 30)?.timestamp.slice(11, 16) ??
    null;

  return {
    temperatureTodayAt15,
    temperatureYesterdayAt15,
    precipitationProbabilityMax,
    precipitationStartHour
  };
}
```

Note: `remainingHoursToday` replaces the old `currentDayHours` — it is today's hours filtered to `timestamp >= currentHourTimestamp` in one pass, instead of "all of today" filtered separately. Rounding uses `currentTime.slice(0, 13)` (`"YYYY-MM-DDTHH"`, 13 characters) + `":00"`, so a `current.time` with non-zero minutes (e.g. `"...T15:45"`) still anchors to the `"...T15:00"` bucket rather than excluding it or shifting to the next hour.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test --test-name-pattern="summarizeHourlyForecast" test/weatherApi.test.js`

Expected: `# tests 9`, `# pass 9`, `# fail 0`.

Do **not** commit yet — `fetchWeather` does not pass `currentTime` until Phase B, so calling it right now would throw `TypeError`. Continue to Phase B before committing.

#### Phase B — wire `current.time` through `fetchWeather`

- [ ] **Step 5: Write the failing tests**

Replace the entire `describe("fetchWeather", ...)` block (`test/weatherApi.test.js:23-197`) with:

```js
describe("fetchWeather", () => {
  it("requests enriched local weather data with the given coordinates", async () => {
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      return response({
        current: { temperature_2m: 26.7, uv_index: 3.2, time: "2026-07-13T00:00" },
        daily: { time: ["2026-07-12", "2026-07-13"], uv_index_max: [4.4, 7.7] },
        hourly: {
          time: [
            "2026-07-12T15:00",
            "2026-07-13T00:00",
            "2026-07-13T15:00",
            "2026-07-13T17:00",
            "2026-07-13T19:00"
          ],
          temperature_2m: [29, 22, 27, 26, 25],
          precipitation_probability: [0, 0, 0, 30, 90]
        }
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
    assert.equal(requestedUrl.searchParams.get("current"), "temperature_2m,uv_index");
    assert.equal(requestedUrl.searchParams.get("daily"), "uv_index_max");
    assert.equal(
      requestedUrl.searchParams.get("hourly"),
      "temperature_2m,precipitation_probability"
    );
    assert.equal(requestedUrl.searchParams.get("past_days"), "1");
    assert.equal(requestedUrl.searchParams.get("forecast_days"), "1");
    assert.equal(requestedUrl.searchParams.get("timezone"), "auto");
    assert.deepEqual(result, {
      temperature: 26.7,
      temperatureTodayAt15: 27,
      temperatureYesterdayAt15: 29,
      uvIndex: 3.2,
      uvIndexMax: 7.7,
      precipitationProbabilityMax: 90,
      precipitationStartHour: "17:00"
    });
  });

  it("returns zero precipitation probability and no noticeable precipitation start hour", async () => {
    const fetchImpl = async () =>
      response({
        current: { temperature_2m: 26.7, uv_index: 3.2, time: "2026-07-13T00:00" },
        daily: { time: ["2026-07-13"], uv_index_max: [7.7] },
        hourly: {
          time: ["2026-07-12T15:00", "2026-07-13T00:00", "2026-07-13T15:00"],
          temperature_2m: [29, 22, 27],
          precipitation_probability: [0, 0, 0]
        }
      });

    const result = await fetchWeather({ latitude: 41.72, longitude: 44.78, fetchImpl });

    assert.equal(result.precipitationProbabilityMax, 0);
    assert.equal(result.precipitationStartHour, null);
  });

  it("recalculates today's rain probability against the current hour, not the whole day", async () => {
    const fetchImpl = async () =>
      response({
        current: { temperature_2m: 18.4, uv_index: 0, time: "2026-07-18T06:42" },
        daily: { time: ["2026-07-17", "2026-07-18"], uv_index_max: [3.1, 2.8] },
        hourly: {
          time: [
            "2026-07-17T15:00",
            "2026-07-18T00:00",
            "2026-07-18T01:00",
            "2026-07-18T06:00",
            "2026-07-18T15:00",
            "2026-07-18T23:00"
          ],
          temperature_2m: [24, 17, 17, 18, 22, 18],
          precipitation_probability: [0, 90, 60, 0, 0, 0]
        }
      });

    const result = await fetchWeather({ latitude: 41.72, longitude: 44.78, fetchImpl });

    assert.equal(result.precipitationProbabilityMax, 0);
    assert.equal(result.precipitationStartHour, null);
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

  it("throws WeatherApiError when current.time is missing", async () => {
    const fetchImpl = async () =>
      response({
        current: { temperature_2m: 26.7, uv_index: 3.2 },
        daily: { time: ["2026-07-13"], uv_index_max: [7.7] },
        hourly: {
          time: ["2026-07-12T15:00", "2026-07-13T00:00", "2026-07-13T15:00"],
          temperature_2m: [29, 22, 27],
          precipitation_probability: [0, 0, 0]
        }
      });

    await assert.rejects(
      () => fetchWeather({ latitude: 41.72, longitude: 44.78, fetchImpl }),
      (error) => error instanceof WeatherApiError && error.details?.fieldName === "current.time"
    );
  });

  it("throws WeatherApiError when the daily local date is missing", async () => {
    const fetchImpl = async () =>
      response({
        current: { temperature_2m: 26.7, uv_index: 3.2, time: "2026-07-13T00:00" },
        daily: { uv_index_max: [7.7] }
      });

    await assert.rejects(
      () => fetchWeather({ latitude: 41.72, longitude: 44.78, fetchImpl }),
      (error) => error instanceof WeatherApiError
    );
  });

  it("throws WeatherApiError when the daily local date is blank", async () => {
    const fetchImpl = async () =>
      response({
        current: { temperature_2m: 26.7, uv_index: 3.2, time: "2026-07-13T00:00" },
        daily: { time: [""], uv_index_max: [7.7] }
      });

    await assert.rejects(
      () => fetchWeather({ latitude: 41.72, longitude: 44.78, fetchImpl }),
      (error) => error instanceof WeatherApiError
    );
  });

  it("throws WeatherApiError when an earlier daily date is blank", async () => {
    const fetchImpl = async () =>
      response({
        current: { temperature_2m: 26.7, uv_index: 3.2, time: "2026-07-13T00:00" },
        daily: {
          time: ["", "2026-07-13"],
          uv_index_max: [4.4, 7.7]
        }
      });

    await assert.rejects(
      () => fetchWeather({ latitude: 41.72, longitude: 44.78, fetchImpl }),
      (error) => error instanceof WeatherApiError
    );
  });

  it("throws WeatherApiError when an earlier daily UV value is missing", async () => {
    const fetchImpl = async () =>
      response({
        current: { temperature_2m: 26.7, uv_index: 3.2, time: "2026-07-13T00:00" },
        daily: {
          time: ["2026-07-12", "2026-07-13"],
          uv_index_max: [undefined, 7.7]
        }
      });

    await assert.rejects(
      () => fetchWeather({ latitude: 41.72, longitude: 44.78, fetchImpl }),
      (error) => error instanceof WeatherApiError
    );
  });

  it("throws WeatherApiError when daily dates and UV values are misaligned", async () => {
    const fetchImpl = async () =>
      response({
        current: { temperature_2m: 26.7, uv_index: 3.2, time: "2026-07-13T00:00" },
        daily: {
          time: ["2026-07-12", "2026-07-13"],
          uv_index_max: [4.4]
        }
      });

    await assert.rejects(
      () => fetchWeather({ latitude: 41.72, longitude: 44.78, fetchImpl }),
      (error) => error instanceof WeatherApiError
    );
  });

  it("throws WeatherApiError when the response body is not valid JSON", async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      async json() {
        throw new SyntaxError("Unexpected token in JSON");
      }
    });

    await assert.rejects(
      () => fetchWeather({ latitude: 41.72, longitude: 44.78, fetchImpl }),
      (error) => error instanceof WeatherApiError
    );
  });
});
```

This adds `current.time` to every fixture that reaches the `current.*` validation (so the pre-existing daily-date tests keep exercising the daily-date checks they are named for, not the new `current.time` check), adds the two new tests, and leaves the coordinate/non-200/invalid-JSON tests untouched.

- [ ] **Step 6: Run to verify it fails**

Run: `node --test --test-name-pattern="fetchWeather" test/weatherApi.test.js`

Expected: `# tests 12`, `# pass 8`, `# fail 4`. Failing:
- "requests enriched local weather data..." and "returns zero precipitation probability..." — `fetchWeather` does not yet extract or pass `currentTime`, so `summarizeHourlyForecast` receives `currentTime: undefined` and `undefined.slice(...)` throws `TypeError`, which surfaces as an uncaught rejection in the `await fetchWeather(...)` call.
- "recalculates today's rain probability against the current hour, not the whole day" — same `TypeError`.
- "throws WeatherApiError when current.time is missing" — also throws `TypeError` (not yet a `WeatherApiError`), so `assert.rejects`'s validator returns `false` and the assertion fails.

The 8 other tests (invalid coordinates, non-200, the 5 daily-date tests, invalid JSON) pass unchanged — they throw before ever reaching `summarizeHourlyForecast`.

- [ ] **Step 7: Implement the minimal wiring**

Add `assertLocalTimestamp` right after `assertFiniteField` (`src/weatherApi.js:47-54`):

```js
function assertFiniteField(value, fieldName, context) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new WeatherApiError(`Open-Meteo response is missing ${fieldName}`, {
      fieldName,
      ...context
    });
  }
}

function assertLocalTimestamp(value, fieldName, context) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    throw new WeatherApiError(`Open-Meteo response is missing ${fieldName}`, {
      fieldName,
      ...context
    });
  }
}
```

Replace `fetchWeather` (`src/weatherApi.js:144-228`) with:

```js
export async function fetchWeather({ latitude, longitude, fetchImpl = globalThis.fetch }) {
  assertCoordinate(latitude, "latitude");
  assertCoordinate(longitude, "longitude");

  const url = new URL(FORECAST_ENDPOINT);
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("current", "temperature_2m,uv_index");
  url.searchParams.set("daily", "uv_index_max");
  url.searchParams.set("hourly", "temperature_2m,precipitation_probability");
  url.searchParams.set("past_days", "1");
  url.searchParams.set("forecast_days", "1");
  url.searchParams.set("timezone", "auto");

  const response = await fetchImpl(url.toString());

  if (!response.ok) {
    throw new WeatherApiError(
      `Open-Meteo forecast request failed with status ${response.status}`,
      { status: response.status, url: url.toString() }
    );
  }

  const body = await parseJson(response, url.toString(), "Open-Meteo forecast");
  const temperature = body?.current?.temperature_2m;
  const uvIndex = body?.current?.uv_index;
  const currentTime = body?.current?.time;
  const dailyDates = body?.daily?.time;
  const dailyUvIndexMax = body?.daily?.uv_index_max;

  assertFiniteField(temperature, "current.temperature_2m", { url: url.toString() });
  assertFiniteField(uvIndex, "current.uv_index", { url: url.toString() });
  assertLocalTimestamp(currentTime, "current.time", { url: url.toString() });

  if (!Array.isArray(dailyDates) || dailyDates.length === 0) {
    throw new WeatherApiError("Open-Meteo response is missing daily.time", {
      url: url.toString()
    });
  }

  if (!Array.isArray(dailyUvIndexMax) || dailyUvIndexMax.length !== dailyDates.length) {
    throw new WeatherApiError("Open-Meteo response has misaligned daily weather data", {
      url: url.toString(),
      dailyDateCount: dailyDates.length,
      dailyUvIndexMaxCount: Array.isArray(dailyUvIndexMax) ? dailyUvIndexMax.length : null
    });
  }

  for (const [index, date] of dailyDates.entries()) {
    if (typeof date !== "string" || date.trim() === "") {
      throw new WeatherApiError("Open-Meteo response is missing a daily date", {
        url: url.toString(),
        index
      });
    }
  }

  for (const [index, value] of dailyUvIndexMax.entries()) {
    assertFiniteField(value, "daily.uv_index_max", { url: url.toString(), index });
  }

  const todayIndex = dailyDates.length - 1;
  const today = dailyDates[todayIndex];
  const uvIndexMax = dailyUvIndexMax[todayIndex];

  const {
    temperatureTodayAt15,
    temperatureYesterdayAt15,
    precipitationProbabilityMax,
    precipitationStartHour
  } = summarizeHourlyForecast({
    today,
    time: body?.hourly?.time,
    temperatures: body?.hourly?.temperature_2m,
    probabilities: body?.hourly?.precipitation_probability,
    currentTime
  });

  return {
    temperature,
    temperatureTodayAt15,
    temperatureYesterdayAt15,
    uvIndex,
    uvIndexMax,
    precipitationProbabilityMax,
    precipitationStartHour
  };
}
```

The only changes from the original: the new `assertLocalTimestamp` call site, the `currentTime` extraction, and passing `currentTime` into `summarizeHourlyForecast`. Everything else (URL building, daily-date validation) is verbatim.

- [ ] **Step 8: Run to verify it passes**

Run: `node --test --test-name-pattern="fetchWeather" test/weatherApi.test.js`

Expected: `# tests 12`, `# pass 12`, `# fail 0`.

- [ ] **Step 9: Update the changelog**

In `CHANGELOG.md`, insert a new bullet into `## [Unreleased]` → `### Changed`, immediately after the existing UV-tile bullet (the one ending "...refetched once on the next load.") and before the favorites-panel-scroll bullet:

```markdown
- The rain tile now recalculates today's probability against the current
  hour instead of the whole day: once an earlier rain window has already
  passed with no more rain expected, the tile drops to 0% instead of
  continuing to show that window's peak and its now-past start time.
  Anchored to `current.time` from Open-Meteo (already returned whenever any
  `current` variable is requested, in the same resolved local timezone as
  the hourly forecast) rather than the browser clock, so the comparison
  holds even when the browser and the chosen city are in different
  timezones. No cache-schema change — only how the existing
  `precipitationProbabilityMax`/`precipitationStartHour` fields are computed.
```

- [ ] **Step 10: Run the full test suite and the syntax check**

Run: `npm test`
Expected: all suites pass, `# fail 0` (full count will be the pre-existing total plus the 6 new `summarizeHourlyForecast` tests and the 2 new `fetchWeather` tests, i.e. pre-existing total + 8).

Run: `npm run check`
Expected: no output, exit code 0 (every `src/*.js` file, including the modified `src/weatherApi.js`, passes `node --check`).

- [ ] **Step 11: Commit**

```bash
git add src/weatherApi.js test/weatherApi.test.js CHANGELOG.md
git commit -m "$(cat <<'EOF'
fix: recalculate today's rain probability against the current hour

summarizeHourlyForecast compared the whole day (00:00-23:00) regardless
of the time of day, so once an early rain window passed the tile kept
showing its stale peak and now-past start hour. Anchor the calculation
to Open-Meteo's current.time (same local timezone as the hourly data,
already returned automatically) and only consider hours from the
current one onward; no more rain expected today now reads as 0%.
EOF
)"
```

---

## Plan Self-Review

**1. Spec coverage** (checked against the root-cause investigation this plan is based on):
- Reported scenario (90% shown at 06:42 for a window around midnight) — covered end-to-end by the "recalculates today's rain probability against the current hour, not the whole day" test in Phase B, built directly from the reported numbers.
- "Recalculate probability AFTER the rain has already finished" — covered by "excludes hours before the current hour..." and "defaults to zero probability when no hourly buckets remain for today" in Phase A.
- A still-relevant, not-yet-started rain window must not be hidden by the filter — covered by "keeps a later rain window that has not started yet".
- Currently-raining edge case (the current hour itself must count, inclusive boundary) — covered by "treats the current hour itself as the earliest possible start".
- `current.time` isn't always exactly on the hour (Open-Meteo current data is 15-minutely) — covered by "rounds the current timestamp down to its hour bucket".
- Stale data for already-elapsed hours must not crash the fetch — covered by "ignores non-finite probabilities for hours that have already passed".
- Missing `current.time` from the API response — covered by "throws WeatherApiError when current.time is missing".
- No gap found: every behavior discussed in the investigation has a corresponding test.

**2. Placeholder scan:** searched this plan for "TBD", "TODO", "implement later", "add appropriate error handling", "similar to Task N" — none found. Every step shows complete, literal code (full function bodies, full test blocks), not fragments or descriptions.

**3. Type/signature consistency:** `summarizeHourlyForecast`'s new `currentTime` parameter (Phase A) is a plain local ISO string `"YYYY-MM-DDTHH:MM"`; `assertLocalTimestamp` (Phase B) validates exactly that shape before `fetchWeather` passes it in. Both sides agree on the name (`currentTime`) and format (13-character date+hour prefix, `.slice(0, 13)`). `fetchWeather`'s return object's keys are unchanged from the current implementation, verified field-by-field against `weatherService.js:39-47` (which destructures `weather.precipitationProbabilityMax` / `weather.precipitationStartHour` — both still present, computed differently but same names/types) and `weatherStore.js`'s `isWeatherCache` required-field list (unchanged).

**4. Blast radius, confirmed by reading (not assuming) the dependents:**
- `test/weatherService.test.js` mocks `fetchWeather` directly with a flat `WEATHER_READING` object — insulated from any change inside `weatherApi.js`.
- `test/weatherSource.test.js` regex-matches `src/newtab.js` source text and `src/newtab.html`/`src/newtab.css` — none of those files change in this plan.
- `src/weatherStore.js`'s `isWeatherCache` required-field list and `WEATHER_CACHE_VERSION` are unchanged, so no migration/refetch-once behavior is triggered for existing users (unlike the earlier UV-index change, which did bump the cache version because it added a field).
- `src/weatherPresentation.js` (`formatPrecipitation`, `rainTone`) is untouched — it only formats whatever `precipitationProbabilityMax`/`precipitationStartHour` it's given, and a `0`/`null` pair already renders correctly today (exercised by the existing "returns zero precipitation probability..." test).

**5. Known, deliberately-unhandled edge case:** if Open-Meteo ever returned a `current.time` whose date does not match the resolved "today" (the last `daily.time` entry) — e.g. a boundary glitch right at local midnight — the `timestamp >= currentHourTimestamp` filter degrades gracefully to "all of today" (since every `"${today}T..."` string sorts after an earlier date's timestamp), which is exactly today's pre-fix behavior. No crash, no test added for it: both fields share the same `timezone=auto` resolution per Open-Meteo's docs, so this combination should not occur in practice, and the degradation is safe if it ever does.

---

Plan complete and saved to `docs/superpowers/plans/2026-07-18-rain-widget-current-hour-recalculation.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
