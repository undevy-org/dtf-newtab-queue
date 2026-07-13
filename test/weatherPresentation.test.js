import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatPm25,
  formatPrecipitation,
  formatTemperature,
  rainTone,
  temperatureTone,
  usAqiTone,
  uvTone
} from "../src/weatherPresentation.js";

describe("temperatureTone", () => {
  it("uses the fixed cool and hot thresholds", () => {
    assert.equal(temperatureTone({ todayAt15: 25, yesterdayAt15: 30 }), "green");
    assert.equal(temperatureTone({ todayAt15: 30, yesterdayAt15: 20 }), "orange");
  });

  it("compares moderate temperatures with yesterday at 15:00", () => {
    assert.equal(temperatureTone({ todayAt15: 27, yesterdayAt15: 28 }), "green");
    assert.equal(temperatureTone({ todayAt15: 27, yesterdayAt15: 27 }), "yellow");
    assert.equal(temperatureTone({ todayAt15: 27, yesterdayAt15: 26 }), "orange");
  });
});

describe("uvTone", () => {
  it("handles inclusive continuous boundaries", () => {
    assert.equal(uvTone(2), "green");
    assert.equal(uvTone(2.1), "orange");
    assert.equal(uvTone(5.9), "orange");
    assert.equal(uvTone(6), "red");
  });
});

describe("usAqiTone", () => {
  it("maps every inclusive AQI band", () => {
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
  });
});

describe("rainTone", () => {
  it("uses neutral for dry conditions and 20-point tiers for rain", () => {
    assert.equal(rainTone(0), "neutral");
    assert.equal(rainTone(1), "rain-1");
    assert.equal(rainTone(20), "rain-1");
    assert.equal(rainTone(21), "rain-2");
    assert.equal(rainTone(40), "rain-2");
    assert.equal(rainTone(41), "rain-3");
    assert.equal(rainTone(60), "rain-3");
    assert.equal(rainTone(61), "rain-4");
    assert.equal(rainTone(80), "rain-4");
    assert.equal(rainTone(81), "rain-5");
    assert.equal(rainTone(90), "rain-5");
    assert.equal(rainTone(100), "rain-5");
  });
});

describe("weather formatting", () => {
  it("keeps weather metric values unrounded", () => {
    assert.equal(formatTemperature(26.7), "26.7");
    assert.deepEqual(formatPrecipitation(90, "17:00"), ["90%", "17:00"]);
    assert.deepEqual(formatPrecipitation(0, null), ["0%", null]);
    assert.equal(formatPm25(9.3), "9.3");
  });
});
