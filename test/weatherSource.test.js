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

  it("places the weather toolbar outside the centered page flow in newtab.html", async () => {
    const markup = await html();
    assert.match(markup, /<section class="panel" id="app">/);
    assert.match(
      markup,
      /<section class="weather-panel" id="weather" aria-live="polite">/
    );
    assert.doesNotMatch(
      markup,
      /<section class="panel weather-panel" id="weather" aria-live="polite">/
    );
    const appIndex = markup.indexOf('id="app"');
    const mainEndIndex = markup.indexOf("</main>");
    const weatherIndex = markup.indexOf('id="weather"');
    assert.ok(appIndex > -1 && mainEndIndex > appIndex && weatherIndex > mainEndIndex);
  });

  it("renders temperature, rain, air, and UV tiles in toolbar order", async () => {
    const code = await source();
    const tilesStart = code.indexOf("function renderWeatherTiles(data)");
    const tilesEnd = code.indexOf("function renderWeather()", tilesStart);
    const tiles = code.slice(tilesStart, tilesEnd);

    assert.ok(tilesStart > -1 && tilesEnd > tilesStart);
    assert.deepEqual(
      [...tiles.matchAll(/tone: (\w+)\(/g)].map((match) => match[1]),
      ["temperatureTone", "rainTone", "usAqiTone", "uvTone"]
    );
    assert.deepEqual(
      [...tiles.matchAll(/size: "(square|wide)"/g)].map((match) => match[1]),
      ["square", "wide", "wide", "square"]
    );
    assert.match(
      tiles,
      /Сейчас \$\{formatTemperature\(data\.temperature\)\}°. Сегодня в 15:00 — \$\{formatTemperature\(data\.temperatureTodayAt15\)\}°, вчера в 15:00 — \$\{formatTemperature\(data\.temperatureYesterdayAt15\)\}°\./
    );
    assert.match(
      tiles,
      /Максимальная вероятность дождя сегодня — \$\{rainPrimary\}, ожидается с \$\{data\.precipitationStartHour\}\./
    );
    assert.match(tiles, /Вероятность дождя сегодня — \$\{rainPrimary\}\./);
    assert.match(
      tiles,
      /US AQI \$\{data\.usAqi\} \(\$\{usAqiCategory\(data\.usAqi\)\}\), PM2\.5 \$\{formatPm25\(data\.pm2_5\)\} µg\/m³\./
    );
    assert.match(
      tiles,
      /Максимальный УФ-индекс сегодня — \$\{data\.uvIndexMax\} \(\$\{uvIndexLevel\(data\.uvIndexMax\)\}\)\./
    );
  });

  it("builds focusable weather tiles with reusable nested tooltips", async () => {
    const code = await source();
    const weatherBlockIndex = code.indexOf("if (weatherRoot) {");
    const tooltipIndex = code.indexOf("function createTooltip(triggerNode, text)");

    assert.ok(tooltipIndex > -1 && tooltipIndex < weatherBlockIndex);
    assert.match(code, /let tooltipIdSeq = 0;/);
    assert.match(code, /triggerNode\.dataset\.tooltipTrigger = "";/);
    assert.match(code, /tooltip\.id = `tooltip-\$\{tooltipIdSeq\+\+\}`;/);
    assert.match(code, /tooltip\.setAttribute\("role", "tooltip"\);/);
    assert.match(code, /triggerNode\.setAttribute\("aria-describedby", tooltip\.id\);/);
    assert.match(code, /triggerNode\.appendChild\(tooltip\);/);
    assert.doesNotMatch(code, /triggerNode\.after\(tooltip\)/);
    assert.match(
      code,
      /function createWeatherTile\(\{ size, tone, primary, secondary = null, tooltipText \}\) \{[\s\S]*?tile\.dataset\.weatherTone = tone;[\s\S]*?tile\.tabIndex = 0;[\s\S]*?createTooltip\(tile, tooltipText\);/
    );
  });

  it("renders the ready or stale toolbar without city or country text and reuses the settings gear", async () => {
    const code = await source();
    const readyStart = code.indexOf("const { status, data, error } = weatherResult;");
    const readyEnd = code.indexOf("weatherRoot.replaceChildren(fragment);", readyStart);
    const readyState = code.slice(readyStart, readyEnd);

    assert.ok(readyStart > -1 && readyEnd > readyStart);
    assert.match(
      readyState,
      /const gear = createNode\("button", "favorite-settings"\);[\s\S]*?gear\.type = "button";[\s\S]*?gear\.dataset\.weatherAction = "edit-city";[\s\S]*?gear\.setAttribute\("aria-label", "Изменить город"\);[\s\S]*?gear\.appendChild\(createIconNode\("settings", \{ size: 20 \}\)\);/
    );
    assert.match(
      readyState,
      /if \(status === "ready" \|\| status === "stale"\) \{\s*fragment\.appendChild\(renderWeatherTiles\(data\)\);\s*\}/
    );
    assert.doesNotMatch(readyState, /location\.(?:name|country)/);
  });

  it("styles wide weather tiles from the shared weather height custom property", async () => {
    const styles = await css();
    assert.match(
      styles,
      /\.weather-tile--wide\s*\{[^}]*width: calc\(var\(--weather-tile-height\) \* 2\);/s
    );
  });

  it("keeps edge weather tooltips inside the viewport and layers stale feedback above the toolbar", async () => {
    const styles = await css();
    const mobileBlock = styles.slice(styles.indexOf("@media (max-width: 600px)"));

    assert.match(
      styles,
      /\.weather-tile:first-child > \.tooltip\s*\{[^}]*left: 0;[^}]*transform: none;/s
    );
    assert.match(
      styles,
      /\.weather-tile:last-child > \.tooltip\s*\{[^}]*left: auto;[^}]*right: 0;[^}]*transform: none;/s
    );
    assert.match(
      mobileBlock,
      /\.weather-tile:nth-child\(2\) > \.tooltip\s*\{[^}]*left: calc\(-1 \* \(var\(--weather-tile-height\) \+ 4px\)\);[^}]*transform: none;/s
    );
    assert.match(
      mobileBlock,
      /\.weather-tile:last-child > \.tooltip\s*\{[^}]*right: calc\(-1 \* \(var\(--weather-tile-height\) \+ 4px\)\);/s
    );
    assert.match(
      styles,
      /\.weather-status\s*\{[^}]*position: absolute;[^}]*z-index: 10;[^}]*bottom: calc\(100% \+ 8px\);/s
    );
    assert.match(styles, /\.tooltip\s*\{[^}]*z-index: 20;/s);
  });

  it("marks stale feedback so it does not become a toolbar flex item", async () => {
    const code = await source();

    assert.match(
      code,
      /if \(status === "stale"\) \{\s*const staleStatus = createStatus\("Не удалось обновить"\);\s*staleStatus\.classList\.add\("weather-status"\);\s*fragment\.appendChild\(staleStatus\);\s*\}/
    );
  });
});
