import { env } from "@/lib/env";
import { fetchWithTimeout } from "@/lib/fetch";
import { haversineMeters, bboxAround } from "@/lib/geo";

type OverpassElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

function pickPoint(el: OverpassElement) {
  if (el.type === "node" && typeof el.lat === "number" && typeof el.lon === "number") return { lat: el.lat, lon: el.lon };
  if (el.center) return { lat: el.center.lat, lon: el.center.lon };
  return null;
}

async function reverseAdminFallback(lat: number, lon: number) {
  const base = env.NOMINATIM_BASE_URL ?? "https://nominatim.openstreetmap.org";
  const url = new URL(`${base}/reverse`);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("zoom", "10");
  url.searchParams.set("addressdetails", "1");

  const ua = env.APP_USER_AGENT;
  const res = await fetchWithTimeout(url, {
    timeoutMs: 12000,
    headers: {
      "User-Agent": ua,
      "Accept": "application/json"
    }
  });

  if (!res.ok) {
    return { ok: false, http: res.status, source: "nominatim" };
  }

  const json = await res.json();
  return { ok: true, source: "nominatim", data: json };
}

function uniqueEndpoints(endpoints: string[]) {
  const seen = new Set<string>();
  return endpoints.filter((url) => {
    if (seen.has(url)) return false;
    seen.add(url);
    return true;
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function capasUrbanismo(lat: number, lon: number, radius_m: number | null) {
  const defaultOverpass = "https://overpass-api.de/api/interpreter";
  const fallbackOverpass = [
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.nchc.org.tw/api/interpreter"
  ];
  const overpassEndpoints = uniqueEndpoints([
    env.OVERPASS_INTERPRETER_URL ?? defaultOverpass,
    ...fallbackOverpass
  ]);
  const r = radius_m ?? 1200;

  // Consulta razonable para infraestructura + usos (OSM)
  const query = `
[out:json][timeout:25];
(
  node(around:${r},${lat},${lon})["amenity"~"hospital|clinic|doctors|pharmacy|school|university|police|fire_station|fuel|marketplace"];
  node(around:${r},${lat},${lon})["public_transport"];
  node(around:${r},${lat},${lon})["railway"="station"];
  way(around:${r},${lat},${lon})["highway"];
  way(around:${r},${lat},${lon})["landuse"];
);
out center 200;
`.trim();

  let res: Response | null = null;
  let usedEndpoint = overpassEndpoints[0] ?? defaultOverpass;
  let lastStatus: number | null = null;

  for (const endpoint of overpassEndpoints) {
    usedEndpoint = endpoint;
    res = await fetchWithTimeout(endpoint, {
      method: "POST",
      timeoutMs: 20000,
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: `data=${encodeURIComponent(query)}`
    });

    if (res.ok) break;
    lastStatus = res.status;
    if (res.status === 429) await sleep(1200);
  }

  if (!res || !res.ok) {
    throw new Error(`Overpass fallo: HTTP ${lastStatus ?? "unknown"}`);
  }

  const json = await res.json();
  const elements: OverpassElement[] = json?.elements ?? [];

  const origin = { lat, lon };

  const scored = elements
    .map((el) => {
      const p = pickPoint(el);
      if (!p) return null;
      const d = haversineMeters(origin, p);
      return { el, p, d };
    })
    .filter(Boolean) as { el: OverpassElement; p: { lat: number; lon: number }; d: number }[];

  scored.sort((a, b) => a.d - b.d);

  const nearest = scored.slice(0, 25).map((x) => ({
    distance_m: Math.round(x.d),
    type: x.el.type,
    tags: x.el.tags ?? {},
    lat: x.p.lat,
    lon: x.p.lon
  }));

  // Conteos simples por categoría
  const counts = {
    hospitals: 0,
    pharmacies: 0,
    schools: 0,
    transport: 0,
    landuse: 0
  };

  for (const e of elements) {
    const t = e.tags ?? {};
    if (t.amenity === "hospital" || t.amenity === "clinic") counts.hospitals++;
    if (t.amenity === "pharmacy") counts.pharmacies++;
    if (t.amenity === "school" || t.amenity === "university") counts.schools++;
    if (t.public_transport || t.railway === "station") counts.transport++;
    if (t.landuse) counts.landuse++;
  }

  // Intento “oficial” IGN: unidad administrativa por bbox (si falla, lo declaras en limitaciones)
  let ignAdmin: any = null;
  try {
    const ign = env.IGN_FEATURES_BASE_URL ?? "https://api-features.ign.es";
    const bb = bboxAround(lat, lon, 0.05);
    const url = new URL(`${ign}/collections/au-administrativeunit/items`);
    url.searchParams.set("bbox", `${bb.minLon},${bb.minLat},${bb.maxLon},${bb.maxLat}`);
    url.searchParams.set("limit", "1");

    const ignRes = await fetchWithTimeout(url, { timeoutMs: 9000, headers: { Accept: "application/geo+json,application/json" } });

    if (ignRes.ok) {
      ignAdmin = { ok: true, source: "ign", data: await ignRes.json() };
    } else {
      const fallback = await reverseAdminFallback(lat, lon);
      ignAdmin = fallback.ok ? fallback : { ok: false, http: ignRes.status, source: "ign" };
    }
  } catch (e: any) {
    const fallback = await reverseAdminFallback(lat, lon);
    ignAdmin = fallback.ok ? fallback : { ok: false, error: e?.message ?? "IGN fallo", source: "ign" };
  }

  return {
    radius_m: r,
    counts,
    nearest,
    ign_admin: ignAdmin,
    admin_source: ignAdmin?.source ?? "ign",
    overpass_used: usedEndpoint,
    overpass_fallback_used: usedEndpoint !== (env.OVERPASS_INTERPRETER_URL ?? defaultOverpass),
    raw_count: elements.length
  };
}
