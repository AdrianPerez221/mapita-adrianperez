import { env } from "@/lib/env";
import { fetchWithTimeout } from "@/lib/fetch";

export async function buscarCoordenadas(direccion: string, country_code: string | null, limit: number | null) {
  const base = env.NOMINATIM_BASE_URL ?? "https://nominatim.openstreetmap.org";

  const url = new URL(`${base}/search`);
  url.searchParams.set("q", direccion);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", String(limit ?? 1));
  if (country_code) url.searchParams.set("countrycodes", country_code);

  const ua = env.APP_USER_AGENT;

  const res = await fetchWithTimeout(url, {
    timeoutMs: 12000,
    headers: {
      "User-Agent": ua,
      "Accept": "application/json"
    }
  });

  if (!res.ok) {
    throw new Error(`Nominatim search falló: HTTP ${res.status}`);
  }

  const json = (await res.json()) as any[];

  if (!json?.length) {
    return {
      found: false,
      reason: "Sin resultados",
      candidates: []
    };
  }

  const best = json[0];
  return {
    found: true,
    lat: Number(best.lat),
    lon: Number(best.lon),
    display_name: best.display_name ?? null,
    raw: best
  };
}
