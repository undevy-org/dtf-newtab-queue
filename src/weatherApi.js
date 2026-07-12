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

async function parseJson(response, url, label) {
  try {
    return await response.json();
  } catch {
    throw new WeatherApiError(`${label} response was not valid JSON`, { url });
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

  const body = await parseJson(response, url.toString(), "Open-Meteo forecast");
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

  const body = await parseJson(response, url.toString(), "Open-Meteo air quality");
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

  const body = await parseJson(response, url.toString(), "Open-Meteo geocoding");
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
