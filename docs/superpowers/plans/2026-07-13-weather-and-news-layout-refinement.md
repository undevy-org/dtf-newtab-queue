# Weather and News Layout Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn weather into a viewport-pinned, data-coloured toolbar and give every actionable news state a right-aligned bottom footer without changing queue or favorites behavior.

**Architecture:** Keep weather fetching, persistence, and orchestration independent. Extend the forecast payload with the two local 15:00 temperatures and hourly precipitation data (looked up by timestamp string, not by array offset), persist the full normalized reading, and put colour/formatting derivation in a small dependency-free pure module. Keep DOM rendering — including a small generic, reusable tooltip helper — in `src/newtab.js`; CSS owns fixed positioning, visual parity, per-tile sizing via a shared height custom property, and the news card's flex-column content/footer layout, where the footer's natural height is never guessed as a constant.

**Tech Stack:** Manifest V3, vanilla ES modules, Open-Meteo, Chrome storage, Node built-in `node:test`, source-pattern UI tests, manual unpacked-extension verification.

---

## File map

| File | Role |
| --- | --- |
| `src/newtab.html` | Move `#weather` out of `<main class="page">` so it can become a fixed toolbar. |
| `src/weatherApi.js` | Request and normalize hourly forecast fields plus `us_aqi`; owns the Russian `usAqiCategory`/`uvIndexLevel` labels. |
| `src/weatherPresentation.js` | Pure colour-tone and value-formatting helpers (no DOM, no labels). |
| `src/weatherStore.js` | Version-2 validation for the enriched cache shape. |
| `src/weatherService.js` | Cache the enriched weather/AQI reading. |
| `src/newtab.js` | Render weather tiles, a generic reusable tooltip helper, and the news card's flex-column content/footer regions. |
| `src/newtab.css` | Toolbar parity, tile geometry/tones, generic tooltip, responsive layout, flex-column news footer. |
| `test/weatherApi.test.js` | API-query and normalization assertions. |
| `test/weatherPresentation.test.js` | Boundary coverage for all display rules. |
| `test/weatherStore.test.js`, `test/weatherService.test.js` | Cache schema and service propagation. |
| `test/weatherSource.test.js`, `test/newtabSource.test.js` | Source-level UI structure assertions. |
| `CHANGELOG.md` | Unreleased user-visible change note. |

### Task 1: Normalize the richer Open-Meteo reading

**Files:**
- Modify: `src/weatherApi.js`
- Modify: `test/weatherApi.test.js`

**Interfaces:**
- Consumes: nothing new — only the existing `WeatherApiError`, `assertFiniteField`, and URL/fetch machinery already in `src/weatherApi.js`.
- Produces (consumed by Task 2's `fetchAndCache()` and, through the cache, by Task 3's rendering):
  - `summarizeHourlyForecast({ today, time, temperatures, probabilities }): { temperatureTodayAt15: number, temperatureYesterdayAt15: number, precipitationProbabilityMax: number, precipitationStartHour: string | null }`
  - `fetchWeather(...): { temperature: number, temperatureTodayAt15: number, temperatureYesterdayAt15: number, uvIndexMax: number, precipitationProbabilityMax: number, precipitationStartHour: string | null }`
  - `fetchAirQuality(...): { usAqi: number, pm2_5: number }`
  - `usAqiCategory(value: number): string` — a Russian label, not English.

- [ ] **Step 1: Add failing forecast-query and normalization assertions**

Replace the first `fetchWeather` fixture with this shape and assert the returned reading:

```js
current: { temperature_2m: 26.7 },
daily: { time: ["2026-07-13"], uv_index_max: [7.7] },
hourly: {
  time: [
    "2026-07-12T15:00", "2026-07-13T00:00",
    "2026-07-13T15:00", "2026-07-13T17:00", "2026-07-13T19:00"
  ],
  temperature_2m: [29, 22, 27, 26, 25],
  precipitation_probability: [0, 0, 0, 30, 90]
}
```

Assert request parameters:

```js
assert.equal(requestedUrl.searchParams.get("daily"), "uv_index_max");
assert.equal(
  requestedUrl.searchParams.get("hourly"),
  "temperature_2m,precipitation_probability"
);
assert.equal(requestedUrl.searchParams.get("past_days"), "1");
assert.equal(requestedUrl.searchParams.get("forecast_days"), "1");
```

Assert result:

```js
assert.deepEqual(result, {
  temperature: 26.7,
  temperatureTodayAt15: 27,
  temperatureYesterdayAt15: 29,
  uvIndexMax: 7.7,
  precipitationProbabilityMax: 90,
  precipitationStartHour: "17:00"
});
```

Trace through the fixture by hand so the numbers are not a coincidence:
`daily.time[0]` is `"2026-07-13"`, so `today = "2026-07-13"` and yesterday is
`"2026-07-12"`. `hourly.time` contains `"2026-07-12T15:00"` at index 0
(temperature `29`) and `"2026-07-13T15:00"` at index 2 (temperature `27`) —
those are `temperatureYesterdayAt15` and `temperatureTodayAt15` respectively.
Today's entries — every timestamp starting with `"2026-07-13T"`, which is
index 1 (`"2026-07-13T00:00"`, prob `0`) through index 4, not just index 2
onward — are index 1 (prob `0`), index 2 (prob `0`), index 3 (prob `30`),
index 4 (prob `90`); the max probability is `90` and the first entry `>= 30`
is index 3, `"2026-07-13T17:00"`, hence `precipitationStartHour: "17:00"`.

Add a second fixture with every today probability `0` and assert
`precipitationProbabilityMax === 0` and `precipitationStartHour === null`.
Add rejection fixtures, each asserted with `assert.throws(..., WeatherApiError)`:
missing `daily.time[0]`; `hourly.time` containing today's `T15:00` entry but
not yesterday's (and vice versa); a today's-15:00 or yesterday's-15:00 index
present in `time` but `undefined`/non-finite in `temperature_2m` at that same
index; and a today's-15:00 entry present with a finite temperature but every
`precipitation_probability` entry for today non-finite (this is the only way
to reach the "missing today's hourly probabilities" branch in Step 3's
`summarizeHourlyForecast` — a fixture with literally no today-prefixed
timestamps at all would instead fail the earlier today-15:00 check, since
`todayAt15` is itself a today-prefixed timestamp).

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `node --test test/weatherApi.test.js`

Expected: failure because the current client requests the daily maximum only and
does not return 15:00 or start-hour data.

- [ ] **Step 3: Implement the forecast normalization**

In `src/weatherApi.js`, replace the forecast query fields with:

```js
url.searchParams.set("current", "temperature_2m");
url.searchParams.set("daily", "uv_index_max");
url.searchParams.set("hourly", "temperature_2m,precipitation_probability");
url.searchParams.set("past_days", "1");
url.searchParams.set("forecast_days", "1");
url.searchParams.set("timezone", "auto");
```

Add a local (not exported) date helper — the array-offset approach this
replaces cannot be made correct, because `past_days`/`forecast_days` only
promise "yesterday and today's local calendar days are present," not a fixed
element count, so yesterday's 15:00 entry must be found by matching its own
timestamp string, not by subtracting 24 from today's index:

```js
function previousLocalDate(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}
```

Add an exported `summarizeHourlyForecast({ today, time, temperatures, probabilities })`:

```js
export function summarizeHourlyForecast({ today, time, temperatures, probabilities }) {
  const todayAt15 = `${today}T15:00`;
  const yesterdayAt15 = `${previousLocalDate(today)}T15:00`;
  const todayIndex = time.indexOf(todayAt15);
  const yesterdayIndex = time.indexOf(yesterdayAt15);
  const temperatureTodayAt15 = temperatures[todayIndex];
  const temperatureYesterdayAt15 = temperatures[yesterdayIndex];

  if (todayIndex === -1 || !Number.isFinite(temperatureTodayAt15)) {
    throw new WeatherApiError("Open-Meteo response is missing today's 15:00 reading", {
      fieldName: "hourly.temperature_2m[today 15:00]",
      todayAt15
    });
  }

  if (yesterdayIndex === -1 || !Number.isFinite(temperatureYesterdayAt15)) {
    throw new WeatherApiError("Open-Meteo response is missing yesterday's 15:00 reading", {
      fieldName: "hourly.temperature_2m[yesterday 15:00]",
      yesterdayAt15
    });
  }

  const todayEntries = time
    .map((timestamp, index) => ({ timestamp, probability: probabilities[index] }))
    .filter(({ timestamp }) => timestamp.startsWith(`${today}T`));

  // `todayEntries.length === 0` can't happen here: todayIndex already passed
  // the check above, and `time[todayIndex] === todayAt15`, which itself
  // starts with `${today}T` — so todayEntries always has at least that one
  // entry. Only a non-finite probability among today's entries is reachable.
  if (todayEntries.some(({ probability }) => !Number.isFinite(probability))) {
    throw new WeatherApiError("Open-Meteo response is missing today's hourly probabilities", {
      fieldName: "hourly.precipitation_probability",
      today
    });
  }

  const precipitationProbabilityMax = Math.max(
    ...todayEntries.map(({ probability }) => probability)
  );
  const firstNoticeable = todayEntries.find(({ probability }) => probability >= 30);
  const precipitationStartHour = firstNoticeable
    ? firstNoticeable.timestamp.slice(11, 16)
    : null;

  return {
    temperatureTodayAt15,
    temperatureYesterdayAt15,
    precipitationProbabilityMax,
    precipitationStartHour
  };
}
```

In `fetchWeather()`, after the existing `temperature`/`uvIndexMax` extraction
and validation, read `today = body?.daily?.time?.[0]` (validate it's a
non-empty string via `assertFiniteField`-style guard, throwing
`WeatherApiError` if missing), call `summarizeHourlyForecast({ today, time:
body?.hourly?.time ?? [], temperatures: body?.hourly?.temperature_2m ?? [],
probabilities: body?.hourly?.precipitation_probability ?? [] })`, and return
`{ temperature, ...summary, uvIndexMax }` — i.e. the exact six-field shape
asserted in Step 1.

Change `fetchAirQuality()` from `european_aqi,pm2_5` to `us_aqi,pm2_5`, read
`body.current.us_aqi`, and return `{ usAqi, pm2_5 }`. Replace
`europeanAqiCategory()` with `usAqiCategory()`, keeping this file's existing
Russian-label convention (matching `UV_INDEX_LEVELS`, which this replacement
sits next to and does not otherwise change):

```js
const US_AQI_CATEGORIES = [
  { max: 50, label: "Хорошо" },
  { max: 100, label: "Умеренно" },
  { max: 150, label: "Вредно для чувствительных групп" },
  { max: 200, label: "Вредно" },
  { max: 300, label: "Очень вредно" },
  { max: Infinity, label: "Опасно" }
];

export function usAqiCategory(value) {
  return (US_AQI_CATEGORIES.find((band) => value <= band.max) ?? US_AQI_CATEGORIES.at(-1)).label;
}
```

- [ ] **Step 4: Update AQI unit tests and run the file**

`test/weatherApi.test.js:3-10` imports `europeanAqiCategory` by name; leaving
that import in place while Step 3 removes the export it names is not merely a
failing assertion — it's a `SyntaxError` at module load (`"... does not
provide an export named 'europeanAqiCategory'"`) that crashes every test in
this file, not just the AQI ones. Change the import to `usAqiCategory`.

Update `describe("fetchAirQuality", ...)`'s first test
(`test/weatherApi.test.js:101-119`, "requests European AQI and PM2.5..."):
rename it to reference US AQI, change the fixture from
`{ current: { european_aqi: 34, pm2_5: 11.4 } }` to
`{ current: { us_aqi: 34, pm2_5: 11.4 } }`, change the asserted `current`
query param from `"european_aqi,pm2_5"` to `"us_aqi,pm2_5"`, and change the
asserted result from `{ europeanAqi: 34, pm2_5: 11.4 }` to
`{ usAqi: 34, pm2_5: 11.4 }`.

Replace `describe("europeanAqiCategory", ...)` (`test/weatherApi.test.js:246-261`)
with `describe("usAqiCategory", ...)`, replacing its European-band assertions
with the Russian boundary labels above for 50, 51, 100, 101, 150, 151, 200,
201, 300, and 301.

Run: `node --test test/weatherApi.test.js`

Expected: PASS.

- [ ] **Step 5: Commit the API slice**

```bash
git add src/weatherApi.js test/weatherApi.test.js
git commit -m "feat: derive weather comparison and rain timing data"
```

### Task 2: Add pure presentation rules and persist the new cache shape

**Files:**
- Create: `src/weatherPresentation.js`
- Create: `test/weatherPresentation.test.js`
- Modify: `src/weatherStore.js`
- Modify: `src/weatherService.js`
- Modify: `test/weatherStore.test.js`
- Modify: `test/weatherService.test.js`

**Interfaces:**
- Consumes: Task 1's `fetchWeather()`/`fetchAirQuality()` result fields (`temperature`, `temperatureTodayAt15`, `temperatureYesterdayAt15`, `uvIndexMax`, `precipitationProbabilityMax`, `precipitationStartHour`, `usAqi`, `pm2_5`).
- Produces:
  - `weatherPresentation.js`: `temperatureTone({ todayAt15, yesterdayAt15 }): string`, `uvTone(value): string`, `usAqiTone(value): string`, `rainTone(value): string`, `formatTemperature(value): string`, `formatPrecipitation(maxProbability, startHour): [string, string | null]`, `formatPm25(value): string`.
  - A version-2 cache document with exactly 11 own fields (`version`, `locationName`, `fetchedAt`, `temperature`, `uvIndexMax`, `precipitationProbabilityMax`, `temperatureTodayAt15`, `temperatureYesterdayAt15`, `precipitationStartHour`, `usAqi`, `pm2_5`) — this is the `data` object Task 3 reads field-by-field.

- [ ] **Step 1: Write failing pure-rule tests**

Create `test/weatherPresentation.test.js` with table-driven assertions
covering every band named in the spec, including both edges of each boundary
(note `assert.deepEqual`, not `assert.equal`, for the two array-returning
`formatPrecipitation` cases — `assert.equal` performs reference equality and
can never pass for two distinct array instances):

```js
assert.equal(temperatureTone({ todayAt15: 25, yesterdayAt15: 23 }), "green");
assert.equal(temperatureTone({ todayAt15: 30, yesterdayAt15: 35 }), "orange");
assert.equal(temperatureTone({ todayAt15: 27, yesterdayAt15: 29 }), "green");
assert.equal(temperatureTone({ todayAt15: 27, yesterdayAt15: 27 }), "yellow");
assert.equal(temperatureTone({ todayAt15: 27, yesterdayAt15: 26 }), "orange");

assert.equal(uvTone(2), "green");
assert.equal(uvTone(2.1), "orange");
assert.equal(uvTone(5.9), "orange");
assert.equal(uvTone(6), "red");

assert.equal(usAqiTone(50), "green");
assert.equal(usAqiTone(51), "yellow");
assert.equal(usAqiTone(100), "yellow");
assert.equal(usAqiTone(101), "orange");
assert.equal(usAqiTone(150), "orange");
assert.equal(usAqiTone(151), "red");
assert.equal(usAqiTone(200), "red");
assert.equal(usAqiTone(201), "purple");
assert.equal(usAqiTone(300), "purple");
assert.equal(usAqiTone(301), "maroon");

assert.equal(rainTone(0), "neutral");
assert.equal(rainTone(1), "rain-1");
assert.equal(rainTone(20), "rain-1");
assert.equal(rainTone(21), "rain-2");
assert.equal(rainTone(90), "rain-5");
assert.equal(rainTone(100), "rain-5");

assert.equal(formatTemperature(26.7), "26.7");
assert.deepEqual(formatPrecipitation(90, "17:00"), ["90%", "17:00"]);
assert.deepEqual(formatPrecipitation(0, null), ["0%", null]);
assert.equal(formatPm25(9.3), "9.3");
```

- [ ] **Step 2: Run it and confirm the module is absent**

Run: `node --test test/weatherPresentation.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Create the presentation module**

Create `src/weatherPresentation.js` exporting exactly these seven functions,
each implementing the corresponding spec rule in full — no threshold is left
unimplemented or partially covered:

```js
export function temperatureTone({ todayAt15, yesterdayAt15 }) {
  if (todayAt15 <= 25) return "green";
  if (todayAt15 >= 30) return "orange";
  if (todayAt15 < yesterdayAt15) return "green";
  if (todayAt15 === yesterdayAt15) return "yellow";
  return "orange";
}

export function uvTone(value) {
  if (value <= 2) return "green";
  if (value < 6) return "orange";
  return "red";
}

const US_AQI_TONES = [
  { max: 50, tone: "green" },
  { max: 100, tone: "yellow" },
  { max: 150, tone: "orange" },
  { max: 200, tone: "red" },
  { max: 300, tone: "purple" },
  { max: Infinity, tone: "maroon" }
];

export function usAqiTone(value) {
  return (US_AQI_TONES.find((band) => value <= band.max) ?? US_AQI_TONES.at(-1)).tone;
}

export function rainTone(value) {
  return value <= 0 ? "neutral" : `rain-${Math.ceil(value / 20)}`;
}

export function formatTemperature(value) {
  return String(value);
}

export function formatPrecipitation(maxProbability, startHour) {
  return [`${maxProbability}%`, startHour];
}

export function formatPm25(value) {
  return String(value);
}
```

`usAqiTone`'s six bands and `US_AQI_CATEGORIES`' six labels (Task 1) share the
same boundaries by design — keep them as two small parallel tables in their
respective modules (tone stays in the pure presentation module; the Russian
label stays with the API layer that already owns `UV_INDEX_LEVELS`), not one
shared import, so `weatherPresentation.js` stays a dependency-free pure module
as the architecture requires.

- [ ] **Step 4: Version the cache and propagate the complete field set through the service**

Set `WEATHER_CACHE_VERSION = 2` in `src/weatherStore.js`. Replace
`isWeatherCache()`'s body with the complete v2 shape — this drops
`"europeanAqi"` (Task 1 stops producing it) and adds the three 15:00/rain
fields plus `usAqi`, alongside every field the cache already carries today
(`temperature`, `uvIndexMax`, `precipitationProbabilityMax` are still
required — Task 3 still renders them):

```js
export function isWeatherCache(value) {
  const requiredFields = [
    "version",
    "locationName",
    "fetchedAt",
    "temperature",
    "uvIndexMax",
    "precipitationProbabilityMax",
    "temperatureTodayAt15",
    "temperatureYesterdayAt15",
    "precipitationStartHour",
    "usAqi",
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
    isFiniteNumber(value.temperatureTodayAt15) &&
    isFiniteNumber(value.temperatureYesterdayAt15) &&
    (value.precipitationStartHour === null || /^\d{2}:00$/.test(value.precipitationStartHour)) &&
    isFiniteNumber(value.usAqi) &&
    isFiniteNumber(value.pm2_5)
  );
}
```

Because `WEATHER_CACHE_VERSION` changed to `2`, any stored `version: 1` entry
now fails `value.version === WEATHER_CACHE_VERSION` on its own, so the service
safely refetches it — no separate migration path is needed.

In `fetchAndCache()` in `src/weatherService.js`, change the object passed to
`cacheStore.setCache()` to exactly this — every field, not a delta from the
current object:

```js
return cacheStore.setCache({
  locationName: location.name,
  fetchedAt: now(),
  temperature: weather.temperature,
  uvIndexMax: weather.uvIndexMax,
  precipitationProbabilityMax: weather.precipitationProbabilityMax,
  temperatureTodayAt15: weather.temperatureTodayAt15,
  temperatureYesterdayAt15: weather.temperatureYesterdayAt15,
  precipitationStartHour: weather.precipitationStartHour,
  usAqi: airQuality.usAqi,
  pm2_5: airQuality.pm2_5
});
```

- [ ] **Step 5: Extend store/service fixtures and run the focused tests**

Change the `cache()` helper in `test/weatherStore.test.js:23-34` to return the
complete version-2 field set above. That alone is not enough — three existing
assertions hardcode the literal cache version and would fail once
`WEATHER_CACHE_VERSION` becomes `2`, not because the new validation rejects
them, but because they assert the old number:

- `test/weatherStore.test.js:93` — `assert.equal(saved.version, 1);` after
  `store.setCache(cache())`. Change the expected value to `2`
  (`createWeatherCacheStore.setCache()` stamps `version: WEATHER_CACHE_VERSION`
  onto whatever `cache()` returns, so this becomes `2` automatically once the
  constant changes — the test just needs to expect it).
- `test/weatherStore.test.js:127-128` and `:136-139` — both write
  `{ version: 1, ...cache() }` / `{ version: 1, ...cache({ temperature:
  Number.NaN }) }` and assert `isWeatherCache(...)` is `true` / `false`
  respectively for "well-formed" and "rejects non-finite" cases. Change both
  to `version: 2`. Left at `version: 1`, the "well-formed" case would silently
  start asserting the opposite of what it's named for: a `version: 1` payload
  is exactly what the new `isWeatherCache` must reject, so the test would
  either fail outright or (worse, if its intent is misread while fixing it)
  get "fixed" by weakening the version check instead of updating the fixture.

Add a *new* assertion, distinct from the three above, that `getCache()`
returns `null` for a stored `version: 1` entry (this is what actually
exercises the version-rejection path end-to-end through storage, which
`isWeatherCache` unit assertions alone do not), and a separate new assertion
that it returns `null` for an otherwise-valid version-2 entry whose
`precipitationStartHour` is `"17:30"` (not on the hour).

Change `WEATHER_READING` and `AIR_READING` in `test/weatherService.test.js` to
the new shapes (add `temperatureTodayAt15`, `temperatureYesterdayAt15`,
`precipitationStartHour` to `WEATHER_READING`; replace `europeanAqi` with
`usAqi` in `AIR_READING`), and assert that `setCity()`'s resolved `data`
includes `usAqi`, `temperatureTodayAt15`, `temperatureYesterdayAt15`, and
`precipitationStartHour: "17:00"`. The existing
`assert.equal(result.data.temperature, 24)` assertion on the stale-cache path
does not need to change — `temperature` remains a required cache field.

Run: `node --test test/weatherPresentation.test.js test/weatherStore.test.js test/weatherService.test.js`

Expected: PASS.

- [ ] **Step 6: Commit the data/cache slice**

```bash
git add src/weatherPresentation.js test/weatherPresentation.test.js src/weatherStore.js src/weatherService.js test/weatherStore.test.js test/weatherService.test.js
git commit -m "feat: cache weather toolbar presentation data"
```

### Task 3: Render and style the weather toolbar

**Files:**
- Modify: `src/newtab.html`
- Modify: `src/newtab.js`
- Modify: `src/newtab.css`
- Modify: `test/weatherSource.test.js`
- Modify: `test/newtabSource.test.js`

**Interfaces:**
- Consumes: Task 2's `weatherPresentation.js` exports and the v2 cache `data` object; the existing, unmodified `usAqiCategory` and `uvIndexLevel` from `weatherApi.js`; the existing `createNode`/`createIconNode` helpers and the `favorite-settings`/`settings`-icon pattern from `createFavoritesGear` in `newtab.js`.
- Produces: `createTooltip(triggerNode, text): HTMLElement` — a generic helper (any future trigger node can call it; nothing about it is weather-specific), used here by the four weather tiles.

- [ ] **Step 1: Add failing source assertions**

Two existing assertions will contradict the new markup and must be replaced,
not left in place:

- `test/weatherSource.test.js:71-74` ("styles the metrics row as a grid")
  currently asserts `.weather-metrics { ... display: grid; ... }`. Replace it
  with an assertion that `.weather-tile--wide { ... width: calc(var(--weather-tile-height) * 2); ... }`
  appears in `newtab.css`.
- `test/weatherSource.test.js:59-69` ("renders the weather panel below the
  news card") currently asserts the literal markup
  `<section class="panel weather-panel" id="weather" aria-live="polite">`.
  Change the expected string to `<section class="weather-panel" id="weather" aria-live="polite">`
  (no `panel` class) — keep the rest of that test (the `#app`-before-`#weather`
  ordering check) unchanged.

Add new assertions in `test/weatherSource.test.js` that the page renders
weather outside the centered `.page` flow, uses the tile order `temperature`,
`rain`, `air`, `uv`, and reuses `createIconNode("settings", { size: 20 })`.
Assert each tile has `data-weather-tone`, `data-tooltip-trigger`, an
`aria-describedby` pointing at a nested child `.tooltip[role="tooltip"]`
node, and that normal-state rendering never touches `location.name` or
`location.country`.

In `test/newtabSource.test.js`, assert `.weather-panel` has `position: fixed`,
`bottom: 16px`, `width: fit-content`, `max-width: calc(100vw - 32px)`,
`--weather-tile-height: 52px`, and `--favorite-tile-height:
var(--weather-tile-height)`; assert the mobile block overrides
`.weather-panel` to `bottom: 10px`, `gap: 4px`, `max-width: calc(100vw -
20px)`, `--weather-tile-height: 44px`; assert `.weather-tile--wide` computes
width as `calc(var(--weather-tile-height) * 2)` (so it scales with the
mobile override automatically).

- [ ] **Step 2: Run source tests and confirm they fail**

Run: `node --test test/weatherSource.test.js test/newtabSource.test.js`

Expected: failure because the current weather panel is a full-width in-flow
card with a city heading, pencil button, and labelled metric cards.

- [ ] **Step 3: Move the weather root out of the centered page flow**

In `src/newtab.html`, leave `<section id="app">` inside `<main class="page">`
and move `<section class="weather-panel" id="weather" aria-live="polite">`
immediately after `</main>`. Do not retain the generic `.panel` class on
`#weather`; the new element is a separate fixed toolbar.

- [ ] **Step 4: Replace weather metric rendering**

Add the generic tooltip helper as a **top-level function**, near the other
shared DOM helpers (`createNode`, `createStatus`) around
`src/newtab.js:47-95` — not nested inside the nested block that holds
`renderWeather()` and its neighbors (that block starts around
`src/newtab.js:1089` and is where `weatherMetricNode` etc. currently live).
Placement is what makes the "reusable" claim in this task's Interfaces block
true: a function nested inside the weather-only block is not actually
callable by anything else, regardless of how generic its body is. Its name
and generated ids are generic too, not `weather`-prefixed, for the same
reason:

```js
let tooltipIdSeq = 0;

function createTooltip(triggerNode, text) {
  triggerNode.dataset.tooltipTrigger = "";
  const tooltip = createNode("div", "tooltip", text);
  tooltip.id = `tooltip-${tooltipIdSeq++}`;
  tooltip.setAttribute("role", "tooltip");
  triggerNode.setAttribute("aria-describedby", tooltip.id);
  // Append as a CHILD, not `triggerNode.after(tooltip)`: at call time
  // triggerNode (the tile) has not been inserted into the document yet, so
  // `.after()` would silently no-op on a parentless node per the DOM spec.
  // Nesting it also gives the tooltip the correct containing block for
  // `position: absolute` — triggerNode itself (`position: relative`) — so it
  // anchors to the specific tile, not to `.weather-panel` as a whole.
  triggerNode.appendChild(tooltip);
  return tooltip;
}
```

In `src/newtab.js`, import the seven helpers from `weatherPresentation.js`
and `usAqiCategory`, `uvIndexLevel` from `weatherApi.js` (both already
exist and are otherwise untouched). Inside the existing weather block, add a
tile constructor, replacing `weatherMetricNode`, `weatherAqiMetricNode`, and
`renderWeatherMetrics` entirely:

```js
function createWeatherTile({ size, tone, primary, secondary = null, tooltipText }) {
  const tile = createNode("div", `weather-tile weather-tile--${size}`);
  tile.dataset.weatherTone = tone;
  tile.tabIndex = 0;

  const values = createNode("div", "weather-tile__values");
  values.appendChild(createNode("span", "weather-tile__primary", primary));
  if (secondary) {
    values.appendChild(createNode("span", "weather-tile__secondary", secondary));
  }
  tile.appendChild(values);

  createTooltip(tile, tooltipText);
  return tile;
}

function renderWeatherTiles(data) {
  const tiles = createNode("div", "weather-tiles");

  tiles.appendChild(
    createWeatherTile({
      size: "square",
      tone: temperatureTone({
        todayAt15: data.temperatureTodayAt15,
        yesterdayAt15: data.temperatureYesterdayAt15
      }),
      primary: formatTemperature(data.temperature),
      tooltipText: `Сейчас ${formatTemperature(data.temperature)}°. Сегодня в 15:00 — ${formatTemperature(data.temperatureTodayAt15)}°, вчера в 15:00 — ${formatTemperature(data.temperatureYesterdayAt15)}°.`
    })
  );

  const [rainPrimary, rainSecondary] = formatPrecipitation(
    data.precipitationProbabilityMax,
    data.precipitationStartHour
  );
  tiles.appendChild(
    createWeatherTile({
      size: "wide",
      tone: rainTone(data.precipitationProbabilityMax),
      primary: rainPrimary,
      secondary: rainSecondary,
      tooltipText: data.precipitationStartHour
        ? `Максимальная вероятность дождя сегодня — ${rainPrimary}, ожидается с ${data.precipitationStartHour}.`
        : `Вероятность дождя сегодня — ${rainPrimary}.`
    })
  );

  tiles.appendChild(
    createWeatherTile({
      size: "wide",
      tone: usAqiTone(data.usAqi),
      primary: String(data.usAqi),
      secondary: `${formatPm25(data.pm2_5)} PM2.5`,
      tooltipText: `US AQI ${data.usAqi} (${usAqiCategory(data.usAqi)}), PM2.5 ${formatPm25(data.pm2_5)} µg/m³.`
    })
  );

  tiles.appendChild(
    createWeatherTile({
      size: "square",
      tone: uvTone(data.uvIndexMax),
      primary: String(data.uvIndexMax),
      tooltipText: `Максимальный УФ-индекс сегодня — ${data.uvIndexMax} (${uvIndexLevel(data.uvIndexMax)}).`
    })
  );

  return tiles;
}
```

The current ready-state branch of `renderWeather()`
(`src/newtab.js:1189-1207`) builds a `.weather-heading` containing the city
name and a pencil button, then conditionally appends a country `<p>`, then a
status-gated call to `renderWeatherMetrics(data)`. All of this must go —
leaving any of it in place (e.g. only swapping the metrics call, or leaving
the old status-gated `renderWeatherMetrics(data)` call dangling after
`renderWeatherMetrics` itself is deleted) either contradicts the spec's "does
not render a city name or country" line and this task's own Step 1 assertions,
or throws a `ReferenceError` on every ready/stale render. Replace the entire
span — from `const heading = ...` through the closing brace of the
`if (status === "ready" || status === "stale") { fragment.appendChild(renderWeatherMetrics(data)); }`
block, i.e. all of current lines 1189-1207 — with:

```js
const gear = createNode("button", "favorite-settings");
gear.type = "button";
gear.dataset.weatherAction = "edit-city";
gear.setAttribute("aria-label", "Изменить город");
gear.appendChild(createIconNode("settings", { size: 20 }));

if (status === "ready" || status === "stale") {
  fragment.appendChild(renderWeatherTiles(data));
}

fragment.appendChild(gear);
```

Tiles come before the gear in DOM/paint order — matching
`renderFavoritesToolbar()`'s existing `list` (tiles) then
`createFavoritesGear()` (settings button) ordering, which is the "exact
visual component" the spec says to reuse. `data-weather-action="edit-city"`
and the rest of the city-form open/cancel behavior are unchanged — only the
button's markup (`favorite-settings` class, `settings` icon) and its removal
from inside a now-deleted `.weather-heading` wrapper are new.

- [ ] **Step 5: Add the fixed-toolbar, tile, and tooltip CSS**

Replace the existing `.weather-panel`, `.weather-heading`, `.weather-metrics`,
and `.weather-metric*` rules with:

```css
.weather-panel {
  position: fixed;
  z-index: 30;
  bottom: 16px;
  left: 50%;
  display: flex;
  align-items: center;
  gap: 12px;
  width: fit-content;
  max-width: calc(100vw - 32px);
  padding: 10px 12px;
  transform: translateX(-50%);
  border: 1px solid var(--border);
  border-radius: 20px;
  background: color-mix(in srgb, var(--panel) 82%, transparent);
  box-shadow: 0 18px 48px rgb(0 0 0 / 22%);
  backdrop-filter: blur(20px) saturate(130%);
  --weather-tile-height: 52px;
  /* .favorite-settings reads --favorite-tile-height; alias it so the reused
     gear button sizes correctly inside .weather-panel's own custom-property
     scope instead of resolving to an unset variable. */
  --favorite-tile-height: var(--weather-tile-height);
}

.weather-tiles {
  display: contents;
}

.weather-tile {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--weather-tile-height);
  height: var(--weather-tile-height);
  border: 1px solid var(--border);
  border-radius: 13px;
  background: var(--panel);
}

.weather-tile--wide {
  width: calc(var(--weather-tile-height) * 2);
}

.weather-tile__values {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  white-space: nowrap;
}

.weather-tile__primary {
  font-size: 18px;
  font-weight: 700;
}

.weather-tile__secondary {
  font-size: 11px;
  font-weight: 500;
  color: var(--muted);
}

.weather-tile[data-weather-tone="green"] { --weather-tone-rgb: 68, 179, 105; }
.weather-tile[data-weather-tone="yellow"] { --weather-tone-rgb: 214, 172, 39; }
.weather-tile[data-weather-tone="orange"] { --weather-tone-rgb: 224, 122, 45; }
.weather-tile[data-weather-tone="red"] { --weather-tone-rgb: 214, 69, 69; }
.weather-tile[data-weather-tone="purple"] { --weather-tone-rgb: 143, 79, 191; }
.weather-tile[data-weather-tone="maroon"] { --weather-tone-rgb: 128, 34, 34; }
.weather-tile[data-weather-tone="neutral"] { --weather-tone-rgb: 148, 158, 171; }
.weather-tile[data-weather-tone^="rain-"] { --weather-tone-rgb: 58, 130, 214; }

.weather-tile[data-weather-tone] {
  border-color: rgba(var(--weather-tone-rgb), 0.6);
  background: linear-gradient(
    135deg,
    rgba(var(--weather-tone-rgb), 0.18),
    rgba(var(--weather-tone-rgb), 0.06)
  );
}

.weather-tile[data-weather-tone="rain-1"] { background: rgba(var(--weather-tone-rgb), 0.12); }
.weather-tile[data-weather-tone="rain-2"] { background: rgba(var(--weather-tone-rgb), 0.24); }
.weather-tile[data-weather-tone="rain-3"] { background: rgba(var(--weather-tone-rgb), 0.36); }
.weather-tile[data-weather-tone="rain-4"] { background: rgba(var(--weather-tone-rgb), 0.48); }
.weather-tile[data-weather-tone="rain-5"] { background: rgba(var(--weather-tone-rgb), 0.6); }

.tooltip {
  display: none;
  position: absolute;
  z-index: 20;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  width: max-content;
  max-width: min(260px, calc(100vw - 32px));
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
  box-shadow: 0 18px 50px rgb(0 0 0 / 10%);
  color: var(--text);
  font-size: 13px;
  line-height: 1.35;
  text-align: center;
  pointer-events: none;
}

[data-tooltip-trigger]:hover > .tooltip,
[data-tooltip-trigger]:focus-visible > .tooltip {
  display: block;
}
```

At `max-width: 600px`, override the toolbar and tile custom property so every
descendant that reads `--weather-tile-height` — the four tiles and the
aliased gear button — shrinks together:

```css
@media (max-width: 600px) {
  .weather-panel {
    bottom: 10px;
    gap: 4px;
    padding: 8px 10px;
    max-width: calc(100vw - 20px);
    --weather-tile-height: 44px;
  }

  .weather-tile__primary {
    font-size: 16px;
  }

  .weather-tile__secondary {
    font-size: 10px;
  }
}
```

The base (desktop) `.weather-panel` rule sets `max-width: calc(100vw - 32px)`
— this media query must override it to `calc(100vw - 20px)` (matching
`.favorites-bar`'s own mobile override) or the following arithmetic doesn't
hold, since the base value is never replaced by cascade on its own.

These numbers are checked against the actual box model, not guessed: the
codebase sets `* { box-sizing: border-box }` globally, so `max-width` bounds
the *total* box (border + padding + content), not just the content. At a
375px-wide viewport (the narrowest common device and 15px narrower than Task
5's "roughly 390px" manual-check width), the total box is capped at
`calc(100vw - 20px)` = 355px; subtracting the 1px border on each side (2px)
and the 10px horizontal padding on each side (20px) leaves 333px for the flex
children. Four tiles (44 + 88 + 88 + 44 = 264px) + four 4px gaps (16px) + the
44px gear button = 324px, nine pixels inside the 333px budget — a real
margin, not a rounding-distance pass, with every secondary group still on one
line. (At Task 5's own "roughly 390px" check this margin grows to about
24px.)

- [ ] **Step 6: Run the source and full automated suite**

Run: `npm test && npm run check`

Expected: PASS.

- [ ] **Step 7: Commit the weather UI slice**

```bash
git add src/newtab.html src/newtab.js src/newtab.css test/weatherSource.test.js test/newtabSource.test.js
git commit -m "feat: render weather as a fixed metric toolbar"
```

### Task 4: Give news actions a fixed right-aligned footer

**Files:**
- Modify: `src/newtab.js`
- Modify: `src/newtab.css`
- Modify: `test/newtabSource.test.js`

**Interfaces:**
- Consumes: the existing `renderShell`/`createButton`/`createStatus` helpers already in `newtab.js`; nothing from Task 1-3.
- Produces: the `.news-content` / `.news-content--milestone` / `.actions` DOM and CSS contract that Task 5's manual verification checks. No later task in this plan consumes anything from Task 4.

The footer is built as a normal flex-column sibling, not an absolutely
positioned overlay: `.panel` becomes a column flex container with exactly two
possible children — `.news-content` (`flex: 1`, so it always fills whatever
space isn't taken by the footer) and, when present, `.actions` (`flex: 0 0
auto`, sized to its own content). This means the footer's height is never a
guessed constant: if `.actions` wraps to two lines on a narrow viewport,
`.news-content` simply gets a little less room automatically — there is no
`calc()` to keep in sync and no risk of the footer overlapping content.

- [ ] **Step 1: Add failing source assertions**

Add assertions that `renderFork()` passes actions in this order:

```js
createButton("Сбросить", "reset"),
createButton("Глубже в архив", "archive"),
createButton("Проверить новые", "retry", { primary: true })
```

Assert `renderArchiveEnded()` passes `createButton("Сбросить", "reset")` then
primary `createButton("Проверить новые", "retry", { primary: true })` (matching
the spec's now-explicit archive-ended ordering), and that `renderCard()`
remains `Просмотрел` then primary `Перейти`.

Assert CSS has `.panel { display: flex; flex-direction: column; ...}` and an
`.actions` footer with `display: flex`, `flex-wrap: wrap`,
`justify-content: flex-end`, and `border-top`. Also update the existing
`test/newtabSource.test.js:193-207` test ("locks the news card to one
constant height"): its desktop regex currently requires `align-content:
start` inside the same `.panel { ... }` block — `.panel` no longer has that
declaration (it's a grid-only property and `.panel` is no longer a grid).
Change that regex to require `display: flex;` and `flex-direction: column;`
in its place instead; leave the `height: 282px;` (desktop) and `height:
356px;` (mobile) checks in that test untouched, since both heights are
preserved exactly.

- [ ] **Step 2: Run the focused source test and confirm it fails**

Run: `node --test test/newtabSource.test.js`

Expected: failure because empty-state actions currently follow the content and
the fork primary button is first.

- [ ] **Step 3: Add explicit news content and footer regions**

Refactor `renderShell()` so it appends title/meta/status/error to a
`<div class="news-content">`. If `actions.length > 0`, append a sibling
`<div class="actions">` after the content. Add the modifier class
`news-content--milestone` to the content div when `icon` is supplied and
`actions.length > 0` — this is the centering hook for fork/archive-ended,
while a normal article stays top-aligned. No other class or `:has()` selector
is needed to reserve footer space; the flex-column layout in Step 4 handles
that automatically regardless of whether `.actions` is present.

Reorder `renderFork()` as required in Step 1. Reorder `renderArchiveEnded()`
to `Сбросить` then primary `Проверить новые`. Leave loading/error without
actions, so they do not render a blank footer.

- [ ] **Step 4: Style the two-region card as a flex column**

Change `.panel` from a grid to a column flex container, moving its padding
and item-spacing down into `.news-content` (which now owns the region that
actually needs them) and keeping its own box purely as the fixed-height,
clipped, bordered card shell:

```css
.panel {
  width: min(680px, 100%);
  display: flex;
  flex-direction: column;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
  box-shadow: 0 18px 50px rgb(0 0 0 / 10%);
  height: 282px;
  overflow: hidden;
}

.news-content {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  gap: 12px;
  padding: 28px;
  overflow: hidden;
}

.news-content--milestone {
  align-items: center;
  justify-content: center;
  text-align: center;
}

.actions {
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 28px;
  border-top: 1px solid var(--border);
  background: var(--panel);
}
```

(`min-height: 0` on `.news-content` is required, not decorative: without it,
a column flex child defaults to `min-height: auto`, which can keep it from
shrinking below its content size even though `flex: 1` says it should share
space with `.actions`.)

At the mobile breakpoint, three separate edits are needed in the same
`@media (max-width: 600px)` block, not just an addition:

1. The pre-existing `.panel { padding: 22px; height: 356px; }` rule
   (`src/newtab.css:707-710`) still sets `padding: 22px` on `.panel` at this
   breakpoint. `.panel` no longer carries padding at any width after Step 4's
   desktop change — remove the `padding: 22px;` line from this existing rule
   and keep `height: 356px;`. Skipping this leaves `.panel` with mobile-only
   padding while `.news-content` also gets its own mobile padding below,
   reintroducing the double-inset this task's flex-column redesign exists to
   remove — just scoped to mobile instead of everywhere.
2. Change the existing rule that currently forces both `.actions` and
   `.favorite-form` into a column — `.actions` must stay a row that wraps,
   per the spec, so only `.favorite-form` keeps the column override. Do not
   touch the general `.button, .favorite-input { width: 100%; }` rule (it is
   still correct for every other button on the page, e.g. the
   favorites-panel's own buttons); instead add a more specific override that
   wins the cascade only for footer buttons.
3. Add mobile padding for `.news-content` and `.actions` that match each
   other horizontally (both `22px`, mirroring the desktop pair both being
   `28px`) — `.actions` has no mobile override otherwise and would stay at
   its desktop `14px 28px`, misaligned against `.news-content`'s narrower
   mobile inset:

```css
@media (max-width: 600px) {
  .favorite-form {
    flex-direction: column;
  }

  .button,
  .favorite-input {
    width: 100%;
  }

  .actions .button {
    width: auto;
  }

  .news-content {
    padding: 22px;
  }

  .actions {
    padding: 10px 22px;
  }
}
```

- [ ] **Step 5: Run all gates**

Run: `npm test && npm run check`

Expected: PASS.

- [ ] **Step 6: Commit the news-footer slice**

```bash
git add src/newtab.js src/newtab.css test/newtabSource.test.js
git commit -m "feat: pin news actions in a right-aligned footer"
```

### Task 5: Update release notes and perform browser verification

**Files:**
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: the finished behavior of Tasks 1-4, end to end.
- Produces: nothing further — this is the plan's terminal task.

- [ ] **Step 1: Add the Unreleased changelog entry**

Under `## [Unreleased]` → `### Changed`, add one bullet describing the
viewport-pinned weather toolbar, the Russian-labelled US AQI/PM2.5 reading,
rain timing, the continuous UV colour boundary, and the fixed news action
footer. Do not rewrite the original weather "Added" bullet; it remains
historically accurate.

- [ ] **Step 2: Run final static gates**

Run: `npm test && npm run check && git diff --check`

Expected: all commands exit 0.

- [ ] **Step 3: Verify in unpacked Chrome**

1. Open `chrome://extensions`, reload the unpacked `dtf-newtab-queue`, then
   open a new tab.
2. At desktop width, verify favorites top offset and weather bottom offset are
   both 16px; verify the weather shell hugs its tiles rather than stretching;
   verify the reused settings gear button in the weather toolbar renders at
   the same 52px size as the favorites gear, not collapsed or unsized (this
   depends on the `--favorite-tile-height: var(--weather-tile-height)` alias
   in Task 3 actually taking effect).
3. Hover and Tab through all weather tiles: full factual tooltips appear in
   Russian with correct units (`µg/m³` for PM2.5, `°` for temperature), never
   explain the colour itself, and the air tile's tooltip shows the Russian
   AQI category (e.g. "Умеренно"), not an English one; city/country never
   appear in ready state; the settings button opens the existing city editor.
4. Check threshold fixtures or temporarily seeded cache values: temperature
   25/30, UV 2/2.1/5.9/6 (confirming the continuous boundary — no fractional
   gap around whole-number UV values), rain 0/20/21/90, and US AQI
   50/51/100/101/150/151/200/201/300/301 (confirming all six bands —
   including purple at 201-300 and maroon at 301+ — render distinctly, not
   falling back to red).
5. Verify fork/archive-ended have centered milestone content and a bordered,
   right-aligned footer; verify archive-ended shows `Сбросить` left of
   primary `Проверить новые`; verify an active card has `Просмотрел` left of
   rightmost `Перейти`; verify the title/meta/status area keeps visible
   vertical spacing between lines in every state (loading, active card, and
   both milestone states) now that spacing lives on `.news-content` instead
   of `.panel`.
6. Repeat at roughly 390px and in dark theme; confirm every weather value
   stays on one line and controls stay reachable. Specifically narrow to the
   fork state (three actions) at ~375px and confirm the action row wraps to a
   second right-aligned line without overlapping or clipping the centered
   milestone icon/title above it.

- [ ] **Step 4: Commit the docs and verification-ready scope**

```bash
git add CHANGELOG.md
git commit -m "docs: describe weather toolbar and news footer refinements"
```

## Plan self-review

This section has been through two adversarial technical review rounds. The
first found ~20 defects (a broken 15:00 lookup algorithm, cache fields
silently dropped, an unnamed CSS grid target, English AQI labels, an
undefined tooltip identifier, and more) — all fixed inline in the tasks
above. A second, independent blind re-verification pass then re-checked every
one of those fixes against the actual current source files and found six of
them incomplete or self-contradictory, plus fourteen further issues — several
introduced by the first round's own fixes (a mobile `max-width` the "checked,
not guessed" arithmetic assumed but the CSS never set; a `.after()` call on a
not-yet-inserted node that would silently drop the tooltip; a stale mobile
`.panel` padding rule left in place alongside the new `.news-content`
padding; the plan's own hand-traced fixture walkthrough undercounting by one
entry; a dead `todayEntries.length === 0` branch; a `createTooltip` nested
inside the weather-only block despite the Interfaces section calling it
generic; and the pre-existing city-name/country heading never being told to
go away). All of those are now fixed inline as well. This section describes
the plan as it stands after both rounds.

- **Spec coverage:** Task 1 covers the 15:00 comparison, precipitation
  max/start-hour, and US AQI/PM2.5 data, using a timestamp-string lookup
  (immune to array-offset drift) instead of a fixed index offset. Task 2
  covers every colour/format rule with full six-band US AQI and continuous
  UV boundary coverage, and versions the cache with its complete field list
  (nothing silently dropped, `europeanAqi` explicitly retired). Task 3 covers
  placement, tile order/shapes/typography, all four colour rules, and a
  concrete, generic, reusable tooltip component with exact per-tile Russian
  text — plus exact desktop and mobile pixel values with the fit-at-375px
  arithmetic shown. Task 4 covers the footer/content split via a flex-column
  layout that structurally cannot let the footer overlap content, every
  approved button ordering (including the now-explicit archive-ended order),
  and the milestone-centering rule. Task 5 covers release notes and a visual
  verification matrix extended to check every gap this review found (label
  locale, boundary continuity, footer wrap, content spacing).
- **Completeness scan:** every implementation step gives complete, runnable
  code — no threshold, DOM wrapper, or CSS target selector is left unnamed,
  and the mobile breakpoint gets the same numeric rigor as desktop (tile
  size, gap, and `max-width` are all overridden together, with the box-model
  arithmetic behind the 375px fit shown, not asserted). Seven pre-existing test
  assertions that the new code would otherwise contradict are called out by
  file and line for replacement, not left for the implementer to discover via
  a failing `npm test`: `weatherApi.test.js:3-10`'s `europeanAqiCategory`
  import (a module-load `SyntaxError`, not just a failing assertion),
  `weatherApi.test.js:101-119`'s European-AQI fixture,
  `weatherApi.test.js:246-261`'s `europeanAqiCategory` describe block,
  `weatherStore.test.js:93,127-128,136-139`'s hardcoded `version: 1`
  assertions, `weatherSource.test.js:59-69`'s literal `.panel
  weather-panel` class string, `weatherSource.test.js:71-74`'s
  `.weather-metrics` grid check, and `newtabSource.test.js:193-207`'s
  `align-content: start` check.
- **Type consistency:** `temperatureTodayAt15`, `temperatureYesterdayAt15`,
  `precipitationStartHour`, and `usAqi` — along with `temperature`,
  `uvIndexMax`, and `precipitationProbabilityMax`, which are equally
  load-bearing for Task 3's rendering — are defined in Task 1, persisted in
  full in Task 2 (shown as a complete object literal, not a delta), and
  consumed in Task 3 under the same names via each task's **Interfaces**
  block.
