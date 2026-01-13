import { env } from "@/lib/env";
import { fetchWithTimeout } from "@/lib/fetch";

type BindingValue = { value: string };
type CityStatsOptions = {
  nameHint?: string | null;
  countryCode?: string | null;
  wikidataId?: string | null;
  language?: string;
};

type EntityPick = {
  id: string;
  label: string | null;
  population: number | null;
  populationDate: string | null;
  areaKm2: number | null;
  areaEstimated: boolean;
  sourceUrl: string | null;
  instanceOf: string[];
};

function parseNumber(value: string | undefined) {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeQid(value: string | null | undefined) {
  if (!value) return null;
  const match = /Q\\d+/.exec(value);
  return match ? match[0] : null;
}

function normalizeName(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildNameCandidates(nameHint: string | null | undefined) {
  if (!nameHint) return [];
  const trimmed = nameHint.trim();
  if (!trimmed) return [];
  const parts = trimmed.split(",").map((p) => p.trim()).filter(Boolean);
  const candidates = parts.length ? [parts[0], trimmed] : [trimmed];
  return Array.from(new Set(candidates));
}

function extractQidsFromClaims(claims: any[] | undefined) {
  if (!claims) return [];
  const ids: string[] = [];
  for (const claim of claims) {
    const id = normalizeQid(claim?.mainsnak?.datavalue?.value?.id ?? null);
    if (id) ids.push(id);
  }
  return ids;
}

function parseWikidataTime(value: string | undefined) {
  if (!value) return null;
  const time = value.replace(/T.*$/, "");
  const ts = Date.parse(time);
  if (Number.isNaN(ts)) return null;
  return { time, ts };
}

function pickLatestPopulation(claims: any[] | undefined) {
  let population: number | null = null;
  let populationDate: string | null = null;
  let latestTs = -Infinity;

  for (const claim of claims ?? []) {
    const amountRaw = claim?.mainsnak?.datavalue?.value?.amount;
    const pop = parseNumber(amountRaw);
    if (pop === null) continue;

    const qualifiers = claim?.qualifiers?.P585 ?? [];
    const qualifier = qualifiers[0];
    const timeInfo = parseWikidataTime(qualifier?.datavalue?.value?.time);

    if (timeInfo && timeInfo.ts >= latestTs) {
      latestTs = timeInfo.ts;
      population = pop;
      populationDate = timeInfo.time;
    } else if (!timeInfo && population === null) {
      population = pop;
    }
  }

  return { population, populationDate };
}

function pickAreaKm2(claims: any[] | undefined) {
  let areaKm2: number | null = null;
  let areaEstimated = false;

  for (const claim of claims ?? []) {
    const amountRaw = claim?.mainsnak?.datavalue?.value?.amount;
    const unit = claim?.mainsnak?.datavalue?.value?.unit ?? "";
    const amount = parseNumber(amountRaw);
    if (amount === null) continue;

    const unitId = normalizeQid(unit);
    let converted = amount;
    let estimated = false;

    if (unitId === "Q712226") {
      converted = amount;
    } else if (unitId === "Q25343") {
      converted = amount / 1_000_000;
    } else if (!unitId) {
      if (amount > 100000) {
        converted = amount / 1_000_000;
        estimated = true;
      }
    } else {
      estimated = true;
    }

    if (areaKm2 === null || converted > areaKm2) {
      areaKm2 = converted;
      areaEstimated = estimated;
    }
  }

  return { areaKm2, areaEstimated };
}

async function fetchWikidataEntity(qid: string, language: string) {
  const url = new URL(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`);
  const res = await fetchWithTimeout(url, {
    timeoutMs: 15000,
    headers: {
      "User-Agent": env.APP_USER_AGENT,
      "Accept": "application/json"
    }
  });

  if (!res.ok) {
    return { ok: false, error: `Wikidata EntityData HTTP ${res.status}` };
  }

  const json = await res.json();
  const entity = json?.entities?.[qid];
  if (!entity) {
    return { ok: false, error: "Entidad Wikidata no encontrada" };
  }

  const label =
    entity?.labels?.[language]?.value ??
    entity?.labels?.es?.value ??
    entity?.labels?.en?.value ??
    null;

  const populationPick = pickLatestPopulation(entity?.claims?.P1082);
  const areaPick = pickAreaKm2(entity?.claims?.P2046);
  const instanceOf = extractQidsFromClaims(entity?.claims?.P31);

  const result: EntityPick = {
    id: qid,
    label,
    population: populationPick.population,
    populationDate: populationPick.populationDate,
    areaKm2: areaPick.areaKm2,
    areaEstimated: areaPick.areaEstimated,
    sourceUrl: `https://www.wikidata.org/wiki/${qid}`,
    instanceOf
  };

  return { ok: true, data: result };
}

async function searchWikidataByName(name: string, language: string) {
  const url = new URL("https://www.wikidata.org/w/api.php");
  url.searchParams.set("action", "wbsearchentities");
  url.searchParams.set("search", name);
  url.searchParams.set("language", language);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "5");

  const res = await fetchWithTimeout(url, {
    timeoutMs: 12000,
    headers: {
      "User-Agent": env.APP_USER_AGENT,
      "Accept": "application/json"
    }
  });

  if (!res.ok) return [];
  const json = await res.json();
  const items = (json?.search ?? []) as { id?: string }[];
  return items.map((i) => i.id).filter(Boolean) as string[];
}

function matchRowByName(rows: Record<string, BindingValue>[], nameHint: string | null) {
  if (!nameHint) return rows[0] ?? null;
  const needle = normalizeName(nameHint);
  const exact = rows.find((row) => normalizeName(row?.placeLabel?.value ?? "") === needle);
  if (exact) return exact;
  const partial = rows.find((row) => normalizeName(row?.placeLabel?.value ?? "").includes(needle));
  return partial ?? rows[0] ?? null;
}

export async function cityStats(lat: number, lon: number, options: CityStatsOptions = {}) {
  const language = options.language ?? "es";
  const nameCandidates = buildNameCandidates(options.nameHint ?? null);
  const wikidataId = normalizeQid(options.wikidataId ?? null);

  if (wikidataId) {
    const entityRes = await fetchWikidataEntity(wikidataId, language);
    if (entityRes.ok && entityRes.data) {
      return {
        ok: true,
        source: "wikidata",
        resolver: "wikidata_id",
        source_url: entityRes.data.sourceUrl,
        city: {
          id: entityRes.data.id,
          label: entityRes.data.label,
          distance_km: null,
          population: entityRes.data.population,
          population_date: entityRes.data.populationDate,
          area_km2: entityRes.data.areaKm2,
          area_estimated: entityRes.data.areaEstimated,
          population_density_km2: null as number | null
        }
      };
    }
  }

  const tryNameSearch = async () => {
    for (const name of nameCandidates) {
      const candidates = await searchWikidataByName(name, language);
      for (const candidate of candidates) {
        const entityRes = await fetchWikidataEntity(candidate, language);
        if (entityRes.ok && entityRes.data) {
          return {
            ok: true,
            source: "wikidata",
            resolver: "name_search",
            source_url: entityRes.data.sourceUrl,
            city: {
              id: entityRes.data.id,
              label: entityRes.data.label,
              distance_km: null,
              population: entityRes.data.population,
              population_date: entityRes.data.populationDate,
              area_km2: entityRes.data.areaKm2,
              area_estimated: entityRes.data.areaEstimated,
              population_density_km2: null as number | null
            }
          };
        }
      }
    }
    return null;
  };

  if (nameCandidates.length) {
    const byName = await tryNameSearch();
    if (byName) return byName;
  }

  const query = `
PREFIX bd: <http://www.bigdata.com/rdf#>
PREFIX wikibase: <http://wikiba.se/ontology#>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX p: <http://www.wikidata.org/prop/>
PREFIX ps: <http://www.wikidata.org/prop/statement/>
PREFIX pq: <http://www.wikidata.org/prop/qualifier/>
PREFIX geo: <http://www.opengis.net/ont/geosparql#>
SELECT ?place ?placeLabel ?distance ?population ?populationDate ?area WHERE {
  SERVICE wikibase:around {
    ?place wdt:P625 ?location .
    bd:serviceParam wikibase:center "Point(${lon} ${lat})"^^geo:wktLiteral .
    bd:serviceParam wikibase:radius "60" .
    bd:serviceParam wikibase:distance ?distance .
  }
  ?place wdt:P31/wdt:P279* wd:Q486972 .
  OPTIONAL {
    ?place p:P1082 ?popStatement .
    ?popStatement ps:P1082 ?population .
    OPTIONAL { ?popStatement pq:P585 ?populationDate . }
  }
  OPTIONAL { ?place wdt:P2046 ?area . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "${language},en". }
}
ORDER BY ?distance
LIMIT 12
`.trim();

  const url = new URL("https://query.wikidata.org/sparql");
  url.searchParams.set("format", "json");
  url.searchParams.set("query", query);

  let res: Response | null = null;
  let sparqlError: string | null = null;
  try {
    res = await fetchWithTimeout(url, {
      timeoutMs: 20000,
      headers: {
        "User-Agent": env.APP_USER_AGENT,
        "Accept": "application/sparql-results+json"
      }
    });
  } catch (e: any) {
    sparqlError = e?.name === "AbortError" ? "Timeout consultando Wikidata SPARQL" : (e?.message ?? "Wikidata fallo");
  }

  if (!res || !res.ok) {
    if (nameCandidates.length) {
      const byName = await tryNameSearch();
      if (byName) return byName;
    }
    return {
      ok: false,
      source: "wikidata",
      error: res ? `Wikidata HTTP ${res.status}` : sparqlError ?? "Wikidata fallo"
    };
  }

  const json = await res.json();
  const rows = (json?.results?.bindings ?? []) as Record<string, BindingValue>[];
  let bestRow = rows.length ? matchRowByName(rows, nameCandidates[0] ?? null) : null;

  if (bestRow) {
    const placeId = normalizeQid(bestRow.place?.value ?? null);
    const distanceKm = parseNumber(bestRow.distance?.value);

    let label = bestRow.placeLabel?.value ?? null;
    let population = parseNumber(bestRow.population?.value);
    let populationDate = bestRow.populationDate?.value ?? null;
    let areaKm2 = parseNumber(bestRow.area?.value);
    let areaEstimated = false;

    if (placeId) {
      const entityRes = await fetchWikidataEntity(placeId, language);
      if (entityRes.ok && entityRes.data) {
        label = entityRes.data.label ?? label;
        population = entityRes.data.population ?? population;
        populationDate = entityRes.data.populationDate ?? populationDate;
        areaKm2 = entityRes.data.areaKm2 ?? areaKm2;
        areaEstimated = entityRes.data.areaEstimated;

        return {
          ok: true,
          source: "wikidata",
          resolver: "coordinates",
          source_url: entityRes.data.sourceUrl,
          city: {
            id: entityRes.data.id,
            label,
            distance_km: distanceKm,
            population,
            population_date: populationDate,
            area_km2: areaKm2,
            area_estimated: areaEstimated,
            population_density_km2: null as number | null
          }
        };
      }
    }

    return {
      ok: true,
      source: "wikidata",
      resolver: "coordinates",
      source_url: placeId ? `https://www.wikidata.org/wiki/${placeId}` : null,
      city: {
        id: placeId,
        label,
        distance_km: distanceKm,
        population,
        population_date: populationDate,
        area_km2: areaKm2,
        area_estimated: areaEstimated,
        population_density_km2: null as number | null
      }
    };
  }

  if (nameCandidates.length) {
    const byName = await tryNameSearch();
    if (byName) return byName;
  }

  return { ok: false, source: "wikidata", error: "Sin datos de poblacion/superficie" };
}
