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
    assert.match(
      markup,
      /<section class="panel weather-panel" id="weather" aria-live="polite">/
    );
    const appIndex = markup.indexOf('id="app"');
    const weatherIndex = markup.indexOf('id="weather"');
    assert.ok(appIndex > -1 && weatherIndex > -1 && appIndex < weatherIndex);
  });

  it("styles the metrics row as a grid in newtab.css", async () => {
    const styles = await css();
    assert.match(styles, /\.weather-metrics\s*\{[^}]*display: grid;/s);
  });
});
