import { fetchWithTimeout } from "@/lib/fetch";

export async function airQuality(lat: number, lon: number) {
  const url = new URL("https://air-quality-api.open-meteo.com/v1/air-quality");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set(
    "current",
    [
      "pm2_5",
      "pm10",
      "us_aqi",
      "eu_aqi",
      "nitrogen_dioxide",
      "ozone",
      "sulphur_dioxide",
      "carbon_monoxide"
    ].join(",")
  );

  const res = await fetchWithTimeout(url, { timeoutMs: 15000 });
  if (!res.ok) {
    return {
      ok: false,
      source: "open-meteo",
      error: `Open-Meteo HTTP ${res.status}`
    };
  }

  const json = await res.json();
  const current = json?.current ?? null;
  if (!current) {
    return {
      ok: false,
      source: "open-meteo",
      error: "Sin datos actuales de calidad del aire"
    };
  }

  return {
    ok: true,
    source: "open-meteo",
    current,
    timezone: json?.timezone ?? null
  };
}
