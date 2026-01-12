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

function systemPrompt() {
  return `
Eres un analista GIS y urbano.
REGLAS DURAS:
- Debes usar SOLO los datos proporcionados.
- No inventes datos ni fuentes.
- Si falta un dato, indicalo en "Limitaciones".

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

async function buildCity(lat: number, lon: number) {
  const reverse = await reverseGeocode(lat, lon, 12);
  const stats = await cityStats(lat, lon);
  if (stats?.ok && stats.city?.population && stats.city?.area_km2) {
    stats.city.population_density_km2 = Number((stats.city.population / stats.city.area_km2).toFixed(2));
  }
  const air = await airQuality(lat, lon);
  const flood = await riesgoInundacion(lat, lon);

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
    if (!cityA.stats?.ok) limitations.push("Ciudad A: sin datos de poblacion/superficie en Wikidata.");
    if (!cityB.stats?.ok) limitations.push("Ciudad B: sin datos de poblacion/superficie en Wikidata.");
    if (!cityA.air?.ok) limitations.push("Ciudad A: sin datos de calidad del aire.");
    if (!cityB.air?.ok) limitations.push("Ciudad B: sin datos de calidad del aire.");
    if (cityA.flood?.fallback_used) limitations.push("Ciudad A: riesgo inundacion con fallback EFAS.");
    if (cityB.flood?.fallback_used) limitations.push("Ciudad B: riesgo inundacion con fallback EFAS.");

    const messages = [
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
