# Audit: Weather Toolbar & News-Card Layout Refinement — Implementation

Date: 2026-07-13
Auditor: Claude (this session), 8-agent code audit + adversarial verification
Scope audited: git worktree `.worktrees/weather-news-layout-refinement`,
branch `codex/weather-news-layout-refinement` (5 commits ahead of `main`,
implemented by Codex against
[the finalized plan](2026-07-13-weather-and-news-layout-refinement.md) and
[spec](../specs/2026-07-13-weather-and-news-layout-refinement-design.md),
both of which went through two rounds of adversarial review before
implementation started).

## Verdict

**Solid. Ready to merge after two small, well-scoped fixes.** All 259
automated tests pass, `npm run check` passes, zero regression to
favorites/queue code, zero scope creep, and the implementation matches the
plan closely enough that in several places it improved on the plan's own
literal code (see below). Two medium-severity gaps survived independent
adversarial verification — neither blocks correctness of the documented
scenarios, both are edge cases the spec/plan never explicitly covered.

Live visual/browser verification (Task 5 Step 3 of the plan) still needs a
human pass — see "What I could not verify" below and the DevTools snippet to
run it.

## Method

8 independent agents, each auditing a different dimension of the real
committed code against the plan/spec (not against each other's summaries),
followed by adversarial verification of every candidate finding (a separate
agent trying to refute each one by re-deriving the logic/CSS/tests by hand
and running the actual test suite). 30 candidate findings were raised across
all dimensions; 28 were refuted on independent re-check (confirmed as
already correctly implemented) and 2 survived verification.

Dimensions covered: Task 1 data/algorithm, Task 2 presentation/cache, Task 3
toolbar DOM/CSS, Task 4 news-card footer, regression/scope, test quality,
cross-task field/identifier integration, and a final line-by-line spec
conformance pass independent of the plan.

## Findings — both fixed (uncommitted, in the worktree)

Both findings below were small enough to fix directly rather than needing a
new session: 4 files, +10/-3 lines total, in
`.worktrees/weather-news-layout-refinement`. `npm test` (259/259) and
`npm run check` pass after the fixes; the boundary-test fix was verified by
re-running the exact mutation (`<= 25`→`< 25`, `>= 30`→`> 30`) that
previously slipped through — it now fails 1/6 in that file as expected, then
was reverted. **Not committed** — left as working-tree changes for review
before landing on `codex/weather-news-layout-refinement`.

### 1. Temperature 25°C/30°C boundary tests can't detect an off-by-one at exactly those thresholds (medium)

`test/weatherPresentation.test.js:15-16` pairs the two boundary tests with
companion `yesterdayAt15` values that happen to produce the same tone via the
fallback comparison branch, even if the dominant `<= 25` / `>= 30` checks
were mutated to `< 25` / `> 30`. Verified by mutation testing: flipping those
two comparisons in `src/weatherPresentation.js` and rerunning the full suite
— **all 259 tests still pass.** The plan's own Step 1 (line 290-291) specified
different companion values (`yesterdayAt15: 23` / `yesterdayAt15: 35`) that
*do* catch this exact mutation; the implemented test swapped in
non-discriminating values instead.

**Fixed:** `test/weatherPresentation.test.js` now uses
`{ todayAt15: 25, yesterdayAt15: 23 }` (green) and
`{ todayAt15: 30, yesterdayAt15: 35 }` (orange) — the plan's original
discriminating values.

### 2. Air-quality tile can overflow its own tile box at severe real-world AQI readings (medium)

`formatPm25()` does no rounding and there's no `overflow`/`max-width`/
`text-overflow` on `.weather-tile__values` or the tile itself. At a real
smog/wildfire-smoke reading (e.g. US AQI 421, PM2.5 225.4 — well inside the
spec's own "301+ maroon" band), the value text measurably overflows the
tile's rounded, tinted background — confirmed by rendering the actual shipped
CSS/markup and measuring: ~7-9px bleed at the 44px-tile mobile breakpoint,
worse at the 360px breakpoint, and already near-zero margin at desktop with
just a 3-digit AQI. None of the 259 tests exercise 3-digit AQI or long PM2.5
values, so this is a genuine, unguarded gap — not something the spec's own
short examples ("51 9.3 PM2.5") ever surfaced.

**Fixed, both layers:** `formatPm25` now does `value.toFixed(1)` instead of
`String(value)` — this caps PM2.5 to the spec's own one-decimal format
(`"9.3"`, not raw floating-point noise like `"9.312345"`) and is the likely
root cause of the worst overflow cases; `.weather-tile__values` got
`max-width: 100%; overflow: hidden;` as a CSS backstop so any value that
still doesn't fit clips at the tile edge instead of visually bleeding past
it. Backed with a new source-regex assertion in
`test/newtabSource.test.js` (`.weather-tile__values` must have
`max-width: 100%` and `overflow: hidden`) and a new
`formatPm25(225.4321) === "225.4"` case in
`test/weatherPresentation.test.js`, per this repo's established pattern of
guarding CSS/DOM behavior with source-text assertions since there's no
jsdom/visual test harness here.

## What was verified correct (representative highlights, not exhaustive — 81 specific items confirmed across all 8 dimensions)

- **Task 1** — the 15:00 lookup genuinely uses date-string matching (not a
  fixed array offset — the bug found and fixed in the plan-review phase never
  made it into the code); `today` is derived as `dailyDates[dailyDates.length
  - 1]`, which is actually more robust than the plan's literal snippet;
  precipitation max/start-hour logic, error handling, and the Russian
  `usAqiCategory` labels all match the spec exactly.
- **Task 2** — `temperatureTone`/`uvTone`/`usAqiTone`/`rainTone` implement
  every spec threshold with the correct inclusive/exclusive boundaries,
  including the continuous UV fix and all six US AQI bands; the cache is
  version 2 with the complete 11-field set (and additionally enforces exact
  field-set equality, not just presence — stricter than the plan asked for);
  `europeanAqi` is fully gone.
- **Task 3** — city name/country are genuinely absent from the ready state
  (the known pre-fix bug does not exist in the shipped code); tile
  order/shapes/typography match the spec's exact examples; `createTooltip`
  is a true top-level, generically-named, generically-scoped helper (not
  nested where only weather code could reach it) using child-insertion, so
  the parentless-node `.after()` bug from the earlier plan draft isn't
  present; the `--weather-tile-height`/`--favorite-tile-height` alias that
  makes the reused gear button size correctly is present and correct; mobile
  arithmetic checks out with real margin at 320-600px, and the implementer
  went beyond the plan by adding an extra `@media (max-width: 360px)` step
  for even narrower devices.
- **Task 4** — flex-column footer (not the old absolute-positioning +
  hardcoded-height-offset approach), correct button order in all three named
  states, correct milestone-centering gate, no double-padding at either
  breakpoint, correct mobile cascade override for footer button width.
- **Regression/scope** — zero diff to any favorites/queue file; the exact 14
  files the plan named were touched and no others; `manifest.json`'s
  Open-Meteo host permissions are already in place; the CHANGELOG's original
  "Added" bullet is untouched as required; no skipped/disabled tests
  anywhere.
- **Cross-task integration** — every field name traced end-to-end from
  `weatherApi.js` → `weatherService.js` → `weatherStore.js` →
  `newtab.js` with zero drift; grepped for every old identifier
  (`weatherMetricNode`, `renderWeatherMetrics`, `europeanAqiCategory`,
  `.weather-heading`, `.weather-metrics`) — none remain.

## What I could not verify (needs a human pass)

Per this repo's own established constraint (the new-tab page renders under
`chrome-extension://` and is sandboxed from every browser-automation surface
available in this environment — this was true for favorites work earlier too,
not new to this feature), I cannot drive the actual unpacked extension myself.
The code-level checks above cover correctness of the logic and CSS as
written; they don't replace looking at the rendered page.

To finish Task 5 Step 3's manual verification, open the extension's new tab,
open DevTools console on that tab, and run:

```js
// Seeds a location (only needed once) and a weather cache reading, then reloads.
async function seedWeatherLocation(name = "Тбилиси", country = "Georgia") {
  await chrome.storage.sync.set({
    dtfWeatherLocation: { version: 1, name, country, latitude: 41.72, longitude: 44.78 }
  });
}

async function seedWeatherCache(overrides = {}) {
  const base = {
    version: 2,
    locationName: "Тбилиси",
    fetchedAt: Date.now(),
    temperature: 26.7,
    uvIndexMax: 7.7,
    precipitationProbabilityMax: 90,
    temperatureTodayAt15: 27,
    temperatureYesterdayAt15: 29,
    precipitationStartHour: "17:00",
    usAqi: 51,
    pm2_5: 9.3
  };
  await chrome.storage.local.set({ dtfWeatherCache: { ...base, ...overrides } });
  location.reload();
}

await seedWeatherLocation(); // run once

// Then call one at a time (each reloads the page automatically):
await seedWeatherCache({ temperatureTodayAt15: 25, temperatureYesterdayAt15: 23 }); // green
await seedWeatherCache({ temperatureTodayAt15: 30, temperatureYesterdayAt15: 35 }); // orange
await seedWeatherCache({ uvIndexMax: 2 });                                          // green
await seedWeatherCache({ uvIndexMax: 2.1 });                                        // orange
await seedWeatherCache({ uvIndexMax: 5.9 });                                        // orange
await seedWeatherCache({ uvIndexMax: 6 });                                          // red
await seedWeatherCache({ precipitationProbabilityMax: 0, precipitationStartHour: null });
await seedWeatherCache({ usAqi: 301, pm2_5: 225.4 });                                // finding #2 repro — watch the AQI tile edges
```

Check, at both desktop and ~375-390px width and in both themes: colours match
the expected band at each seed above; tooltips show full Russian facts on
hover/Tab; the settings gear opens the existing city editor at the correct
size; fork/archive-ended footers are centered/bordered/right-aligned with the
correct button order; the fork state's 3-button footer wraps cleanly at
narrow width without overlapping the centered icon above it; and — per
finding #2 — whether the AQI/PM2.5 tile actually visibly overflows at the
`usAqi: 301, pm2_5: 225.4` seed on your machine's real font rendering.

## Bottom line

Both fixes are applied and green (259/259 tests, `npm run check` clean),
sitting as uncommitted changes in the worktree pending review. Nothing found
requires touching the algorithm, cache shape, or architecture again. The
only remaining step is the human browser pass above — everything code-level
is done.
