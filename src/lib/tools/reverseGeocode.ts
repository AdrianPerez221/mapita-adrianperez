import { env } from "@/lib/env";
import { fetchWithTimeout } from "@/lib/fetch";

export async function reverseGeocode(lat: number, lon: number, zoom: number | null) {
  const base = env.NOMINATIM_BASE_URL ?? "https://nominatim.openstreetmap.org";

  const url = new URL(`${base}/reverse`);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("zoom", String(zoom ?? 18));
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("namedetails", "1");
  url.searchParams.set("extratags", "1");

  const ua = env.APP_USER_AGENT;
  const res = await fetchWithTimeout(url, {
    timeoutMs: 12000,
    headers: {
      "User-Agent": ua,
      "Accept": "application/json"
    }
  });

  if (!res.ok) {
    return {
      ok: false,
      error: `Nominatim reverse fallo: HTTP ${res.status}`,
      source: "nominatim"
    };
  }

  const json = await res.json();
  return {
    ok: true,
    source: "nominatim",
    display_name: json?.display_name ?? null,
    address: json?.address ?? null,
    namedetails: json?.namedetails ?? null,
    extratags: json?.extratags ?? null,
    category: json?.category ?? null,
    type: json?.type ?? null,
    place_id: json?.place_id ?? null,
    osm_type: json?.osm_type ?? null,
    osm_id: json?.osm_id ?? null,
    lat: json?.lat ? Number(json.lat) : null,
    lon: json?.lon ? Number(json.lon) : null,
    raw: json
  };
}
