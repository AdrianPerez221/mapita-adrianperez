import { NextResponse } from "next/server";
import { z } from "zod";
import { openai } from "@/lib/openai";
import { env } from "@/lib/env";

import { buscarCoordenadas } from "@/lib/tools/buscarCoordenadas";
import { reverseGeocode } from "@/lib/tools/reverseGeocode";
import { historicalWeather } from "@/lib/tools/historicalWeather";
import { historicalEvents } from "@/lib/tools/historicalEvents";

const BodySchema = z.object({
  address: z.string().nullable().optional(),
  lat: z.number().nullable().optional(),
  lon: z.number().nullable().optional(),
});

const SOURCES = [
  { name: "Nominatim (OSM)", url: "https://nominatim.org/release-docs/latest/develop/overview/" },
  { name: "Open-Meteo Archive", url: "https://open-meteo.com/en/docs/historical-weather-api" },
  { name: "NASA EONET", url: "https://eonet.gsfc.nasa.gov/docs/v3" },
];

const REQUIRED_HEADINGS = [
  "Resumen de zona",
  "Temperatura (ultimos 5 anos)",
  "Lluvias (ultimos 5 anos)",
  "Incendios registrados",
  "Inundaciones registradas",
  "Otros peligros relevantes",
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
Eres un analista GIS con enfoque historico (ultimos 5 anos).
REGLAS DURAS:
- Debes usar SOLO los datos proporcionados.
- No inventes datos ni eventos.
- Si no hay registros, indicalo claramente en "Limitaciones".
- Usa los datos de weather.summary para temperatura y lluvias.
- Usa events (NASA EONET) para incendios, inundaciones y otros peligros.
- Cita la fuente con su URL en "Fuentes consultadas".

Devuelve el informe en Markdown con estas secciones exactas:
## Resumen de zona
## Temperatura (ultimos 5 anos)
## Lluvias (ultimos 5 anos)
## Incendios registrados
## Inundaciones registradas
## Otros peligros relevantes
## Fuentes consultadas
## Limitaciones

Bibliografia permitida (usa solo estas):
${SOURCES.map((s) => `- ${s.name}: ${s.url}`).join("\n")}
`.trim();
}

export async function POST(req: Request) {
  try {
    const body = BodySchema.parse(await req.json());
    const hasCoords = typeof body.lat === "number" && typeof body.lon === "number";
    const hasAddress = typeof body.address === "string" && body.address.trim().length > 0;

    if (!hasCoords && !hasAddress) {
      return NextResponse.json({ ok: false, error: "Debes enviar address o lat/lon" }, { status: 400 });
    }

    let coords: any = hasCoords ? { lat: body.lat!, lon: body.lon!, display_name: null } : null;
    const limitations: string[] = [];

    if (!hasCoords && hasAddress) {
      const geo = await buscarCoordenadas(body.address!, "es", 1);
      if (!geo?.found || typeof geo.lat !== "number" || typeof geo.lon !== "number") {
        return NextResponse.json(
          { ok: false, error: "No se pudo geocodificar la direccion. Verifica el texto ingresado." },
          { status: 422 }
        );
      }
      coords = {
        lat: geo.lat,
        lon: geo.lon,
        display_name: geo.display_name ?? null,
        address: geo.address ?? null
      };
    }

    const reverse = await reverseGeocode(coords.lat, coords.lon, 16);
    if (reverse?.ok) {
      coords.display_name = reverse.display_name ?? coords.display_name ?? null;
      coords.address = reverse.address ?? coords.address ?? null;
    } else {
      limitations.push("reverseGeocode: no se pudo obtener direccion cercana.");
    }

    const weather = await historicalWeather(coords.lat, coords.lon, 5);
    if (!weather?.ok) limitations.push("Clima: no se pudo obtener historico de Open-Meteo.");

    const events = await historicalEvents(coords.lat, coords.lon, 5, 1.0);
    if (!events?.ok) limitations.push("EONET: no se pudieron consultar eventos historicos.");
    if (events?.ok && events.total_events === 0) limitations.push("EONET: sin eventos registrados en el area.");

    const messages: any[] = [
      { role: "system", content: systemPrompt() },
      {
        role: "user",
        content: [
          `Coordenadas: ${coords.lat}, ${coords.lon}`,
          `Zona: ${coords.display_name ?? "Sin nombre"}`,
          `Datos (JSON):`,
          JSON.stringify({ coords, reverse, weather, events })
        ].join("\n")
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
      coords,
      reverse,
      weather,
      events,
      report_markdown: report,
      sources: SOURCES,
      limitations: limitations.length ? limitations : ["Sin incidencias destacables en los datos consultados."],
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Error en history" }, { status: 500 });
  }
}
