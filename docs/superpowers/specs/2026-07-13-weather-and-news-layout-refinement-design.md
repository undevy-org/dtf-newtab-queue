# Design: Weather Toolbar and News-Card Layout Refinement

Date: 2026-07-13  
Status: approved in brainstorming; revised after technical review to close UV
boundary, AQI label locale, tooltip-reuse, and archive-ended ordering gaps.

## Scope

Refine the already implemented weather widget and the DTF news-card layout in
the new-tab extension. This is presentation and derived-data work only: the
weather location, Open-Meteo cache model, favorites, and queue mechanics stay
independent as they are today.

## Weather toolbar

### Placement and container

- The weather section is fixed to the bottom of the viewport.
- Its bottom margin equals the favorites toolbar's top margin: 16px on desktop
  and 10px at the existing mobile breakpoint.
- Its container uses `width: fit-content`, just like the favorites toolbar: it
  is only as wide as its four metric tiles, gaps, padding, and settings button.
  It must never stretch across the viewport or leave a large empty interior.
- The shell shares the favorites toolbar's visual language: translucent panel,
  border, rounded corners, shadow, and backdrop blur.
- The weather shell does not render a city name or country.
- The city-change control is a distinct weather action, but reuses the exact
  visual component and settings icon used by the favorites toolbar.

### Tile grid and typography

The left-to-right order is:

1. temperature — square;
2. precipitation — 2:1 rectangle;
3. air quality — 2:1 rectangle;
4. UV index — square.

All tiles retain the favorites tile's rounding and colored-outline treatment.
The two square tiles render only their number: for example `26.7` and `7.7`.
The two rectangular tiles render one centered inline data group:

- precipitation: `90% 17:00`;
- air quality: `51 9.3 PM2.5`.

The primary values (`26.7`, `90%`, `51`, `7.7`) use one shared size and weight.
The secondary values (`17:00`, `9.3 PM2.5`) use a smaller, lighter shared type
style. Each rectangular group is centered within its tile; its primary and
secondary values align to the primary number's typographic baseline. The group
must remain on one line at all supported widths.

### Data and colour rules

The number in the temperature tile is the current temperature. Its colour is
derived from the local 15:00 temperature today and yesterday, in this priority
order:

1. today at 15:00 is `<= 25°C`: green;
2. today at 15:00 is `>= 30°C`: orange;
3. otherwise (`25°C < today at 15:00 < 30°C`): lower than yesterday at 15:00
   is green, equal is yellow, higher is orange.

The UV tile represents the daily maximum UV index, which Open-Meteo reports as
a fractional number (for example `7.7`), so the boundary is continuous, not
banded by whole numbers:

- `<= 2`: green;
- `> 2` and `< 6`: orange;
- `>= 6`: red.

The precipitation tile shows the maximum hourly probability for today. Its
blue tint grows in intensity with that percentage in five even steps of the
0–100% range (`ceil(percentage / 20)`, so 1–20% is step 1 through 81–100% is
step 5); a 0% forecast is neutral and uses no step. The second value is the
first local hour whose hourly probability reaches `>= 30%`, rendered precisely
as `HH:00`. The source is hourly, so half-hour times must not be invented. If
the maximum probability is 0%, render only a centered `0%` and no secondary
value.

The air tile uses US AQI, replacing the present European AQI. It displays US
AQI followed by PM2.5 concentration and uses the IQAir/US AQI colour scale:
0–50 green, 51–100 yellow, 101–150 orange, 151–200 red, 201–300 purple,
301+ maroon. The category label used in the tooltip (see below) is Russian,
matching every other user-facing label in this UI (the existing UV risk
labels and button text): Хорошо, Умеренно, Вредно для чувствительных групп,
Вредно, Очень вредно, Опасно, in that band order.

### Tooltips

Every tile exposes a tooltip on hover and keyboard focus. Tooltips contain the
full factual data and units, but do not explain the colour itself:

- temperature: current temperature plus local 15:00 values for today/yesterday;
- precipitation: maximum chance plus first noticeable-rain time;
- air: US AQI category and PM2.5 value in `µg/m³`;
- UV: full daily UV maximum and risk label.

The existing custom title popover is a useful style/accessibility reference,
but the weather behavior must be a reusable tooltip pattern rather than a
title-only special case. Concretely: implement it as a small generic helper
(for example `createTooltip(triggerNode, text)`) that attaches a
hover/focus-visible-shown node with a stable id and returns that node — not
code that is hard-wired to the weather tiles' markup or, like the title
popover, conditional on a truncation check. The four weather tiles are its
first callers; the point is that a future caller could attach the same
helper to an unrelated element without copying markup or CSS.

## News card

The news card remains a fixed-height component. It is divided into a content
area and a bottom action footer.

- The footer is fixed at the bottom whenever a state has actions and is
  separated from content with a visible top border.
- Action rows are right aligned.
- The primary action is visually rightmost and placed last in DOM order so
  keyboard traversal remains natural.
- In the "all fresh read" state, the visual/DOM order is `Сбросить` →
  `Глубже в архив` → `Проверить новые`.
- In the "archive finished" state, the visual/DOM order is `Сбросить` →
  `Проверить новые`, mirroring the fork state's placement of `Сбросить` first
  and the primary retry action last.
- In an active-news state, it is `Просмотрел` → `Перейти`.
- The active-news headline and metadata remain top-aligned in the content
  region; only milestone/empty states receive centered composition.
- In the two milestone states (fresh queue finished and archive finished),
  icon, title, and explanation are centered horizontally and vertically in the
  available content area above the footer.
- Loading and error states with no actions do not create an empty footer.

## Data flow and resilience

`src/weatherApi.js` will request the existing current temperature together with
hourly `temperature_2m` and `precipitation_probability`, local timezone, and
one previous day. The renderer/service derives the two local 15:00 readings,
the day's precipitation maximum, and the first hourly probability at or above
30%. These derived values are stored alongside the existing weather cache so
the normal 30-minute TTL and stale-while-error behavior remain intact.

The air request changes from `european_aqi` to `us_aqi` while retaining
`pm2_5`. Weather failures remain isolated from favorites and news.

## Verification

- Unit-test the new weather response normalization, derived 15:00 comparison,
  precipitation threshold/time rules, 0% state, UV thresholds, US AQI
  thresholds, cache validation, and stale-cache behavior.
- Source-level tests assert the metric order, weather tooltip content, fit-content
  toolbar treatment, and fixed/footer action structure.
- Manually verify desktop and mobile layouts, light/dark themes, hover and Tab
  tooltips, equal viewport offsets above/below, all news states, and all weather
  colour threshold boundaries.

## Out of scope

- Geolocation, multiple cities, hourly forecasts as a separate UI, background
  refresh, other weather metrics, and changes to queue/favorites data behavior.
- Half-hour precipitation timing: the requested probability source is hourly.
