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

  it("throws WeatherApiError when the response body is not valid JSON", async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      async json() {
        throw new SyntaxError("Unexpected token in JSON");
      }
    });

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

  it("throws WeatherApiError when the response body is not valid JSON", async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      async json() {
        throw new SyntaxError("Unexpected token in JSON");
      }
    });

    await assert.rejects(
      () => geocodeCity("Тбилиси", { fetchImpl }),
      (error) => error instanceof WeatherApiError
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
