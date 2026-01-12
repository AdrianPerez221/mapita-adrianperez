import { env } from "@/lib/env";
import { fetchWithTimeout } from "@/lib/fetch";

type BindingValue = { value: string };

function parseNumber(value: string | undefined) {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function cityStats(lat: number, lon: number) {
  const query = `
PREFIX bd: <http://www.bigdata.com/rdf#>
PREFIX wikibase: <http://wikiba.se/ontology#>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX p: <http://www.wikidata.org/prop/>
PREFIX ps: <http://www.wikidata.org/prop/statement/>
PREFIX pq: <http://www.wikidata.org/prop/qualifier/>
PREFIX geo: <http://www.opengis.net/ont/geosparql#>
SELECT ?city ?cityLabel ?distance ?population ?populationDate ?area WHERE {
  SERVICE wikibase:around {
    ?city wdt:P625 ?location .
    bd:serviceParam wikibase:center "Point(${lon} ${lat})"^^geo:wktLiteral .
    bd:serviceParam wikibase:radius "50" .
    bd:serviceParam wikibase:distance ?distance .
  }
  ?city wdt:P31/wdt:P279* wd:Q515 .
  OPTIONAL {
    ?city p:P1082 ?popStatement .
    ?popStatement ps:P1082 ?population .
    OPTIONAL { ?popStatement pq:P585 ?populationDate . }
  }
  OPTIONAL { ?city wdt:P2046 ?area . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "es,en". }
}
ORDER BY ?distance
LIMIT 10
`.trim();

  const url = new URL("https://query.wikidata.org/sparql");
  url.searchParams.set("format", "json");
  url.searchParams.set("query", query);

  const res = await fetchWithTimeout(url, {
    timeoutMs: 15000,
    headers: {
      "User-Agent": env.APP_USER_AGENT,
      "Accept": "application/sparql-results+json"
    }
  });

  if (!res.ok) {
    return {
      ok: false,
      source: "wikidata",
      error: `Wikidata HTTP ${res.status}`
    };
  }

  const json = await res.json();
  const rows = (json?.results?.bindings ?? []) as Record<string, BindingValue>[];
  if (!rows.length) {
    return { ok: false, source: "wikidata", error: "Sin ciudad cercana" };
  }

  const cityId = rows[0]?.city?.value ?? null;
  if (!cityId) {
    return { ok: false, source: "wikidata", error: "Sin identificador de ciudad" };
  }

  const cityRows = rows.filter((r) => r.city?.value === cityId);
  const label = cityRows[0]?.cityLabel?.value ?? null;
  const distanceKm = parseNumber(cityRows[0]?.distance?.value);

  let population: number | null = null;
  let populationDate: string | null = null;
  let latestDate = 0;

  for (const row of cityRows) {
    const pop = parseNumber(row.population?.value);
    const date = row.populationDate?.value ?? null;
    if (pop === null) continue;
    if (date) {
      const ts = Date.parse(date);
      if (!Number.isNaN(ts) && ts >= latestDate) {
        latestDate = ts;
        population = pop;
        populationDate = date;
      }
    } else if (population === null) {
      population = pop;
    }
  }

  const area = parseNumber(cityRows[0]?.area?.value);

  return {
    ok: true,
    source: "wikidata",
    city: {
      id: cityId,
      label,
      distance_km: distanceKm,
      population,
      population_date: populationDate,
      area_km2: area
    }
  };
}
