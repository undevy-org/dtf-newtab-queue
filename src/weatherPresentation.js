const US_AQI_TONES = [
  { max: 50, tone: "green" },
  { max: 100, tone: "yellow" },
  { max: 150, tone: "orange" },
  { max: 200, tone: "red" },
  { max: 300, tone: "purple" },
  { max: Infinity, tone: "maroon" }
];

export function temperatureTone({ todayAt15, yesterdayAt15 }) {
  if (todayAt15 <= 25) {
    return "green";
  }

  if (todayAt15 >= 30) {
    return "orange";
  }

  if (todayAt15 < yesterdayAt15) {
    return "green";
  }

  if (todayAt15 === yesterdayAt15) {
    return "yellow";
  }

  return "orange";
}

export function uvTone(value) {
  if (value <= 2) {
    return "green";
  }

  if (value < 6) {
    return "orange";
  }

  return "red";
}

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
  return value.toFixed(1);
}
