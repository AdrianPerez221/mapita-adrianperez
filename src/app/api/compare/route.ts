import { NextResponse } from "next/server";
import { z } from "zod";
import { openai } from "@/lib/openai";
import { env } from "@/lib/env";
import { reverseGeocode } from "@/lib/tools/reverseGeocode";
import { riesgoInundacion } from "@/lib/tools/riesgoInundacion";
import { cityStats } from "@/lib/tools/cityStats";
import { airQuality } from "@/lib/tools/airQuality";

const BodySchema = z.object({
  a: z.object({ lat: z.number(), lon: z.number() }),
  b: z.object({ lat: z.number(), lon: z.number() }),
});

const SOURCES = [
  { name: "Nominatim (OSM)", url: "https://nominatim.org/release-docs/latest/develop/overview/" },
  { name: "Wikidata SPARQL", url: "https://query.wikidata.org/" },
  { name: "Wikidata EntityData", url: "https://www.wikidata.org/wiki/Special:EntityData/" },
  { name: "Open-Meteo Air Quality", url: "https://open-meteo.com/en/docs/air-quality-api" },
  { name: "Copernicus EFAS WMS", url: "https://european-flood.emergency.copernicus.eu/api/wms/" },
];

const REQUIRED_HEADINGS = [
  "Ciudad A",
  "Ciudad B",
  "Comparacion VS",
  "Poblacion",
  "Superficie",
  "Contaminacion",
  "Riesgos de inundacion",
  "Otros indicadores",
  "Recomendacion final",
  "Fuentes consultadas",
  "Limitaciones",
];

function hasRequiredHeadings(report: string) {
  if (!report) return false;
  return REQUIRED_HEADINGS.every((heading) => {
    const re = new RegExp(`^##\\s+${heading}\\s*$`, "mi");
    return re.test(report);
  });
}

function pickPlaceName(reverse: any) {
  const address = reverse?.address ?? null;
  const name =
    address?.city ||
    address?.town ||
    address?.village ||
    address?.municipality ||
    address?.county ||
    address?.state ||
    address?.region ||
    null;

  if (name) return name;
  const display = typeof reverse?.display_name === "string" ? reverse.display_name : null;
  if (display) return display.split(",")[0]?.trim() ?? null;
  return null;
}

function systemPrompt() {
  return `
Eres un analista GIS y urbano.
REGLAS DURAS:
- Debes usar SOLO los datos proporcionados.
- No inventes datos ni fuentes.
- Si falta un dato, indicalo en "Limitaciones".
 - Para poblacion y superficie, indica la fuente (usa cityA/cityB.stats.source_url si esta disponible).

Devuelve el informe en Markdown con estas secciones exactas:
## Ciudad A
## Ciudad B
## Comparacion VS
## Poblacion
## Superficie
## Contaminacion
## Riesgos de inundacion
## Otros indicadores
## Recomendacion final
## Fuentes consultadas
## Limitaciones

Bibliografia permitida (usa solo estas):
${SOURCES.map((s) => `- ${s.name}: ${s.url}`).join("\n")}
`.trim();
}

function normalizeToolError(e: any) {
  if (e?.name === "AbortError") return "Timeout consultando API externa.";
  return e?.message ?? "Fallo inesperado consultando API externa.";
}

async function safeToolCall<T>(fallback: (e: unknown) => T, fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (e) {
    return fallback(e);
  }
}

async function buildCity(lat: number, lon: number) {
  const reverse = await safeToolCall(
    (e) => ({ ok: false, source: "nominatim", error: normalizeToolError(e) }),
    () => reverseGeocode(lat, lon, 12)
  );
  const nameHint = pickPlaceName(reverse);
  const countryCode = reverse?.address?.country_code ?? null;
  const wikidataId = reverse?.extratags?.wikidata ?? null;
  const stats = await safeToolCall(
    (e) => ({ ok: false, source: "wikidata", error: normalizeToolError(e) }),
    () => cityStats(lat, lon, { nameHint, countryCode, wikidataId, language: "es" })
  );
  if (stats?.ok && stats.city?.population && stats.city?.area_km2) {
    stats.city = {
      ...stats.city,
      population_density_km2: Number((stats.city.population / stats.city.area_km2).toFixed(2))
    };
  }
  const air = await safeToolCall(
    (e) => ({ ok: false, source: "open-meteo", error: normalizeToolError(e) }),
    () => airQuality(lat, lon)
  );
  const flood = await safeToolCall(
    (e) => ({
      ok: false,
      method: "copernicus_wms",
      reason: normalizeToolError(e),
      note: "No se pudo consultar EFAS WMS",
      fallback_used: true
    }),
    () => riesgoInundacion(lat, lon)
  );

  return {
    coords: { lat, lon },
    reverse,
    stats,
    air,
    flood
  };
}

export async function POST(req: Request) {
  try {
    const body = BodySchema.parse(await req.json());

    const cityA = await buildCity(body.a.lat, body.a.lon);
    const cityB = await buildCity(body.b.lat, body.b.lon);

    const limitations: string[] = [];
    if (!cityA.reverse?.ok) limitations.push("Ciudad A: sin reverse geocode.");
    if (!cityB.reverse?.ok) limitations.push("Ciudad B: sin reverse geocode.");
    if (!cityA.stats?.ok) {
      limitations.push("Ciudad A: sin datos de poblacion/superficie.");
    } else {
      if (cityA.stats?.city?.population == null) limitations.push("Ciudad A: poblacion no disponible.");
      if (cityA.stats?.city?.area_km2 == null) limitations.push("Ciudad A: superficie no disponible.");
      if (cityA.stats?.city?.area_estimated) limitations.push("Ciudad A: superficie estimada por unidad no explicita.");
    }
    if (!cityB.stats?.ok) {
      limitations.push("Ciudad B: sin datos de poblacion/superficie.");
    } else {
      if (cityB.stats?.city?.population == null) limitations.push("Ciudad B: poblacion no disponible.");
      if (cityB.stats?.city?.area_km2 == null) limitations.push("Ciudad B: superficie no disponible.");
      if (cityB.stats?.city?.area_estimated) limitations.push("Ciudad B: superficie estimada por unidad no explicita.");
    }
    if (!cityA.air?.ok) limitations.push("Ciudad A: sin datos de calidad del aire.");
    if (!cityB.air?.ok) limitations.push("Ciudad B: sin datos de calidad del aire.");
    if (cityA.flood?.fallback_used) limitations.push("Ciudad A: riesgo inundacion con fallback EFAS.");
    if (cityB.flood?.fallback_used) limitations.push("Ciudad B: riesgo inundacion con fallback EFAS.");

    const messages: any[] = [
      { role: "system", content: systemPrompt() },
      {
        role: "user",
        content: `Datos para comparar:\nCiudad A:\n${JSON.stringify(cityA)}\n\nCiudad B:\n${JSON.stringify(cityB)}`
      },
    ];

    let report = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const completion = await openai.chat.completions.create({
        model: env.OPENAI_MODEL,
        messages,
        temperature: 0.2,
      });
      report = completion.choices[0]?.message?.content ?? "";
      if (hasRequiredHeadings(report)) break;
      messages.push({
        role: "user",
        content: "El informe no cumple el formato. Devuelve SOLO el informe con las secciones exactas requeridas."
      });
    }

    return NextResponse.json({
      ok: true,
      report_markdown: report,
      cityA,
      cityB,
      sources: SOURCES,
      limitations: limitations.length ? limitations : ["Sin incidencias destacables reportadas por las tools."],
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Error en compare" }, { status: 500 });
  }
}
