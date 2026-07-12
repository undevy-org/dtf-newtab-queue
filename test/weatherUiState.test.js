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
