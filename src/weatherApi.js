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

const US_AQI_CATEGORIES = [
  { max: 50, label: "Хорошо" },
  { max: 100, label: "Умеренно" },
  { max: 150, label: "Вредно для чувствительных групп" },
  { max: 200, label: "Вредно" },
  { max: 300, label: "Очень вредно" },
  { max: Infinity, label: "Опасно" }
];

export function uvIndexLevel(value) {
  return (UV_INDEX_LEVELS.find((band) => value <= band.max) ?? UV_INDEX_LEVELS.at(-1)).label;
}

export function usAqiCategory(value) {
  return (US_AQI_CATEGORIES.find((band) => value <= band.max) ?? US_AQI_CATEGORIES.at(-1)).label;
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

function previousLocalDate(dateString) {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString);

  if (!parts) {
    throw new WeatherApiError("Open-Meteo response has invalid daily.time[0]", { dateString });
  }

  const [year, month, day] = parts.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new WeatherApiError("Open-Meteo response has invalid daily.time[0]", { dateString });
  }

  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function hourlyTimestampIndex(time, timestamp) {
  const index = Array.isArray(time) ? time.indexOf(timestamp) : -1;

  if (index === -1) {
    throw new WeatherApiError("Open-Meteo response is missing hourly timestamp", { timestamp });
  }

  return index;
}

export function summarizeHourlyForecast({ today, time, temperatures, probabilities }) {
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

  const currentDayHours = (Array.isArray(time) ? time : [])
    .map((timestamp, index) => ({
      timestamp,
      probability: Array.isArray(probabilities) ? probabilities[index] : undefined
    }))
    .filter(
      ({ timestamp }) =>
        typeof timestamp === "string" && timestamp.startsWith(`${today}T`)
    );

  for (const { timestamp, probability } of currentDayHours) {
    assertFiniteField(probability, "hourly.precipitation_probability", { timestamp });
  }

  const precipitationProbabilityMax = Math.max(
    ...currentDayHours.map(({ probability }) => probability)
  );
  const precipitationStartHour =
    currentDayHours.find(({ probability }) => probability >= 30)?.timestamp.slice(11, 16) ?? null;

  return {
    temperatureTodayAt15,
    temperatureYesterdayAt15,
    precipitationProbabilityMax,
    precipitationStartHour
  };
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
  const dailyDates = body?.daily?.time;
  const dailyUvIndexMax = body?.daily?.uv_index_max;

  assertFiniteField(temperature, "current.temperature_2m", { url: url.toString() });
  assertFiniteField(uvIndex, "current.uv_index", { url: url.toString() });

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
    probabilities: body?.hourly?.precipitation_probability
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

export async function fetchAirQuality({ latitude, longitude, fetchImpl = globalThis.fetch }) {
  assertCoordinate(latitude, "latitude");
  assertCoordinate(longitude, "longitude");

  const url = new URL(AIR_QUALITY_ENDPOINT);
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("current", "us_aqi,pm2_5");

  const response = await fetchImpl(url.toString());

  if (!response.ok) {
    throw new WeatherApiError(
      `Open-Meteo air quality request failed with status ${response.status}`,
      { status: response.status, url: url.toString() }
    );
  }

  const body = await parseJson(response, url.toString(), "Open-Meteo air quality");
  const usAqi = body?.current?.us_aqi;
  const pm2_5 = body?.current?.pm2_5;

  assertFiniteField(usAqi, "current.us_aqi", { url: url.toString() });
  assertFiniteField(pm2_5, "current.pm2_5", { url: url.toString() });

  return { usAqi, pm2_5 };
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
