import { fetchWithTimeout } from "@/lib/fetch";
import { bboxAround, haversineMeters } from "@/lib/geo";

type EventSummary = {
  id: string;
  title: string;
  categories: string[];
  category_titles: string[];
  date_start: string | null;
  date_end: string | null;
  distance_km: number | null;
  sources: string[];
};

function buildDateRange(years: number) {
  const end = new Date();
  const start = new Date();
  start.setFullYear(end.getFullYear() - years);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

function pickDates(geometry: any[]) {
  if (!Array.isArray(geometry) || !geometry.length) return { start: null, end: null };
  const dates = geometry
    .map((g) => g?.date)
    .filter((d) => typeof d === "string") as string[];
  if (!dates.length) return { start: null, end: null };
  const sorted = [...dates].sort();
  return { start: sorted[0], end: sorted[sorted.length - 1] };
}

function pickDistance(lat: number, lon: number, geometry: any[]) {
  if (!Array.isArray(geometry) || !geometry.length) return null;
  const point = { lat, lon };
  let best: number | null = null;
  for (const g of geometry) {
    const coords = g?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const [lonEv, latEv] = coords;
    if (typeof latEv !== "number" || typeof lonEv !== "number") continue;
    const d = haversineMeters(point, { lat: latEv, lon: lonEv });
    if (best === null || d < best) best = d;
  }
  return best !== null ? Math.round(best / 100) / 10 : null;
}

export async function historicalEvents(lat: number, lon: number, years = 5, deltaDeg = 1.0) {
  const range = buildDateRange(years);
  const bb = bboxAround(lat, lon, deltaDeg);
  const bbox = `${bb.minLon},${bb.minLat},${bb.maxLon},${bb.maxLat}`;
  const limit = 200;

  const events: any[] = [];
  for (let page = 1; page <= 3; page += 1) {
    const url = new URL("https://eonet.gsfc.nasa.gov/api/v3/events");
    url.searchParams.set("start", range.start);
    url.searchParams.set("end", range.end);
    url.searchParams.set("bbox", bbox);
    url.searchParams.set("status", "all");
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("page", String(page));

    const res = await fetchWithTimeout(url, { timeoutMs: 20000 });
    if (!res.ok) {
      return {
        ok: false,
        source: "nasa-eonet",
        error: `EONET HTTP ${res.status}`
      };
    }
    const json = await res.json();
    const batch = Array.isArray(json?.events) ? json.events : [];
    if (!batch.length) break;
    events.push(...batch);
    if (batch.length < limit) break;
  }

  const categories: Record<string, { title: string; count: number }> = {};
  const summaries: EventSummary[] = events.map((ev) => {
    const catList = Array.isArray(ev?.categories) ? ev.categories : [];
    for (const cat of catList) {
      const id = String(cat?.id ?? "unknown");
      const title = String(cat?.title ?? id);
      if (!categories[id]) categories[id] = { title, count: 0 };
      categories[id].count += 1;
    }

    const { start, end } = pickDates(ev?.geometry ?? []);
    const distance = pickDistance(lat, lon, ev?.geometry ?? []);
    const sources = Array.isArray(ev?.sources) ? ev.sources : [];

    return {
      id: String(ev?.id ?? ""),
      title: String(ev?.title ?? "Evento sin titulo"),
      categories: catList.map((c: any) => String(c?.id ?? "")).filter(Boolean),
      category_titles: catList.map((c: any) => String(c?.title ?? "")).filter(Boolean),
      date_start: start,
      date_end: end,
      distance_km: distance,
      sources: sources.map((s: any) => String(s?.url ?? "")).filter(Boolean),
    };
  });

  summaries.sort((a, b) => {
    const dateA = a.date_end ?? a.date_start ?? "";
    const dateB = b.date_end ?? b.date_start ?? "";
    return dateB.localeCompare(dateA);
  });

  return {
    ok: true,
    source: "nasa-eonet",
    period: { ...range, years },
    bbox: bb,
    total_events: summaries.length,
    categories,
    events: summaries.slice(0, 20),
  };
}
