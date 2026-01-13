import { fetchWithTimeout } from "@/lib/fetch";

type NumberOrNull = number | null;

function toNumbers(values: unknown) {
  if (!Array.isArray(values)) return [] as number[];
  return values.filter((v) => typeof v === "number" && Number.isFinite(v)) as number[];
}

function sum(values: number[]) {
  return values.reduce((acc, v) => acc + v, 0);
}

function avg(values: number[]) {
  if (!values.length) return null;
  return sum(values) / values.length;
}

function min(values: number[]) {
  if (!values.length) return null;
  return Math.min(...values);
}

function max(values: number[]) {
  if (!values.length) return null;
  return Math.max(...values);
}

function countAbove(values: number[], threshold: number) {
  return values.filter((v) => v >= threshold).length;
}

function countBelow(values: number[], threshold: number) {
  return values.filter((v) => v <= threshold).length;
}

function round(value: NumberOrNull, digits = 1) {
  if (value === null) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function buildDateRange(years: number) {
  const end = new Date();
  const start = new Date();
  start.setFullYear(end.getFullYear() - years);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

export async function historicalWeather(lat: number, lon: number, years = 5) {
  const range = buildDateRange(years);
  const url = new URL("https://archive-api.open-meteo.com/v1/archive");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("start_date", range.start);
  url.searchParams.set("end_date", range.end);
  url.searchParams.set(
    "daily",
    [
      "temperature_2m_max",
      "temperature_2m_min",
      "temperature_2m_mean",
      "precipitation_sum",
      "rain_sum",
      "snowfall_sum",
      "precipitation_hours",
      "windspeed_10m_max"
    ].join(",")
  );
  url.searchParams.set("timezone", "UTC");
  url.searchParams.set("temperature_unit", "celsius");
  url.searchParams.set("windspeed_unit", "kmh");
  url.searchParams.set("precipitation_unit", "mm");

  const res = await fetchWithTimeout(url, { timeoutMs: 20000 });
  if (!res.ok) {
    return {
      ok: false,
      source: "open-meteo-archive",
      error: `Open-Meteo HTTP ${res.status}`
    };
  }

  const json = await res.json();
  const daily = json?.daily ?? null;
  if (!daily) {
    return {
      ok: false,
      source: "open-meteo-archive",
      error: "Sin datos diarios en Open-Meteo"
    };
  }

  const tempMax = toNumbers(daily.temperature_2m_max);
  const tempMin = toNumbers(daily.temperature_2m_min);
  const tempMean = toNumbers(daily.temperature_2m_mean);
  const precipitation = toNumbers(daily.precipitation_sum);
  const rain = toNumbers(daily.rain_sum);
  const snowfall = toNumbers(daily.snowfall_sum);
  const precipHours = toNumbers(daily.precipitation_hours);
  const windMax = toNumbers(daily.windspeed_10m_max);

  const summary = {
    days: tempMean.length || precipitation.length || windMax.length,
    temperature: {
      mean_c: round(avg(tempMean)),
      max_c: round(max(tempMax)),
      min_c: round(min(tempMin)),
      days_over_30: countAbove(tempMax, 30),
      days_over_35: countAbove(tempMax, 35),
      days_below_0: countBelow(tempMin, 0),
    },
    precipitation: {
      total_mm: round(sum(precipitation)),
      avg_mm: round(avg(precipitation)),
      max_day_mm: round(max(precipitation)),
      days_over_10mm: countAbove(precipitation, 10),
      days_over_20mm: countAbove(precipitation, 20),
      wet_hours_total: round(sum(precipHours), 0),
    },
    rain: {
      total_mm: round(sum(rain)),
      snowfall_total_cm: round(sum(snowfall)),
    },
    wind: {
      max_kmh: round(max(windMax)),
      days_over_50kmh: countAbove(windMax, 50),
      days_over_70kmh: countAbove(windMax, 70),
    }
  };

  return {
    ok: true,
    source: "open-meteo-archive",
    period: { ...range, years },
    daily_units: json?.daily_units ?? null,
    summary
  };
}
