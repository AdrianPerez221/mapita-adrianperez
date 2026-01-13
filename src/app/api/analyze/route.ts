import { NextResponse } from "next/server";
import { z } from "zod";
import { openai } from "@/lib/openai";
import { env } from "@/lib/env";

import { buscarCoordenadas } from "@/lib/tools/buscarCoordenadas";
import { capasUrbanismo } from "@/lib/tools/capasUrbanismo";
import { riesgoInundacion } from "@/lib/tools/riesgoInundacion";
import { reverseGeocode } from "@/lib/tools/reverseGeocode";
import { cityStats } from "@/lib/tools/cityStats";

const BodySchema = z.object({
  address: z.string().nullable().optional(),
  lat: z.number().nullable().optional(),
  lon: z.number().nullable().optional(),
  radius_m: z.number().int().min(200).max(5000).nullable().optional(),
});

const SOURCES = [
  { name: "Nominatim (OSM)", url: "https://nominatim.org/release-docs/latest/develop/overview/" },
  { name: "Overpass API (OSM)", url: "https://wiki.openstreetmap.org/wiki/Overpass_API" },
  { name: "IGN API Features", url: "https://api-features.ign.es/" },
  { name: "Wikidata SPARQL", url: "https://query.wikidata.org/" },
  { name: "Wikidata EntityData", url: "https://www.wikidata.org/wiki/Special:EntityData/" },
  { name: "Copernicus EFAS WMS", url: "https://european-flood.emergency.copernicus.eu/api/wms/" },
];

const REQUIRED_HEADINGS = [
  "Descripcion de zona",
  "Infraestructura cercana",
  "Riesgos relevantes",
  "Posibles usos urbanos",
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

function toNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function pickPlaceName(address: Record<string, string> | null | undefined, displayName?: string | null) {
  if (address) {
    const name =
      address.city ||
      address.town ||
      address.village ||
      address.municipality ||
      address.county ||
      address.state ||
      address.region;
    if (name) return name;
  }
  if (displayName) {
    return displayName.split(",")[0]?.trim() ?? null;
  }
  return null;
}

function systemPrompt() {
  return `
Eres un analista GIS.
REGLAS DURAS:
- Debes usar SOLO los datos devueltos por las tools.
- No inventes fuentes ni datos.
- Si una tool falla o no hay cobertura: dilo en "Limitaciones".
- Si el usuario ya manda lat/lon: NO llames buscarCoordenadas.
- Siempre llama reverseGeocode, capasUrbanismo, riesgoInundacion y cityStats antes de redactar el informe final.
- Si urbanismo falla o hay pocos datos, usa reverseGeocode para describir la calle/zona mas cercana.
- Si hay datos de poblacion/superficie (cityStats), incluyelos en "Descripcion de zona" e indica la fuente (usa stats.source_url si esta disponible).

Devuelve el informe en Markdown con estas secciones exactas:
## Descripcion de zona
## Infraestructura cercana
## Riesgos relevantes
## Posibles usos urbanos
## Recomendacion final
## Fuentes consultadas
## Limitaciones

Bibliografia permitida (usa solo estas):
${SOURCES.map((s) => `- ${s.name}: ${s.url}`).join("\n")}
`.trim();
}

export async function POST(req: Request) {
  try {
    const body = BodySchema.parse(await req.json());
    const radius = body.radius_m ?? 1200;

    const hasCoords = typeof body.lat === "number" && typeof body.lon === "number";
    const hasAddress = typeof body.address === "string" && body.address.trim().length > 0;
    const geocodeRequired = hasAddress && !hasCoords;

    if (!hasCoords && !hasAddress) {
      return NextResponse.json({ ok: false, error: "Debes enviar address o lat/lon" }, { status: 400 });
    }

    const tools: any[] = [
      {
        type: "function",
        function: {
          name: "buscarCoordenadas",
          description: "Convierte una direccion en coordenadas usando Nominatim (OpenStreetMap).",
          parameters: {
            type: "object",
            properties: { direccion: { type: "string" } },
            required: ["direccion"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "capasUrbanismo",
          description: "Devuelve infraestructura/urbanismo alrededor del punto (Overpass + intento IGN).",
          parameters: {
            type: "object",
            properties: {
              lat: { type: "number" },
              lon: { type: "number" },
              radius_m: { type: "number" },
            },
            required: ["lat", "lon", "radius_m"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "riesgoInundacion",
          description: "Consulta riesgo/indicadores de inundacion (Copernicus EFAS WMS).",
          parameters: {
            type: "object",
            properties: { lat: { type: "number" }, lon: { type: "number" } },
            required: ["lat", "lon"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "reverseGeocode",
          description: "Convierte coordenadas en direccion cercana con datos administrativos (Nominatim reverse).",
          parameters: {
            type: "object",
            properties: {
              lat: { type: "number" },
              lon: { type: "number" },
              zoom: { type: "number" },
            },
            required: ["lat", "lon"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "cityStats",
          description: "Busca poblacion y superficie de la ciudad/municipio mas cercano (Wikidata).",
          parameters: {
            type: "object",
            properties: {
              lat: { type: "number" },
              lon: { type: "number" },
              name_hint: { type: "string" },
              country_code: { type: "string" },
              wikidata_id: { type: "string" },
            },
            required: ["lat", "lon"],
            additionalProperties: false,
          },
        },
      },
    ];

    const messages: any[] = [
      { role: "system", content: systemPrompt() },
      {
        role: "user",
        content: hasCoords
          ? `El usuario selecciono un punto en el mapa: lat=${body.lat}, lon=${body.lon}. Ejecuta reverseGeocode, capasUrbanismo, riesgoInundacion y cityStats.`
          : `El usuario escribio una direccion: "${body.address}". Primero usa buscarCoordenadas; luego usa reverseGeocode, capasUrbanismo, riesgoInundacion y cityStats.`,
      },
    ];

    let coords: any = hasCoords ? { lat: body.lat!, lon: body.lon!, display_name: null } : null;
    let urban: any = null;
    let flood: any = null;
    let reverse: any = null;
    let stats: any = null;
    let geocodeFailed = false;
    let geocodeUsed = !geocodeRequired;
    let reverseUsed = false;

    const limitations: string[] = [];
    const debug: any = { tool_calls: [] };

    for (let step = 0; step < 6; step++) {
      const completion = await openai.chat.completions.create({
        model: env.OPENAI_MODEL,
        messages,
        tools,
        tool_choice: "auto",
        temperature: 0.2,
      });

      const msg = completion.choices[0]?.message;
      if (!msg) throw new Error("OpenAI no devolvio message");

      messages.push(msg);

      const toolCalls = msg.tool_calls ?? [];

      if (!toolCalls.length) {
        const report_markdown = msg.content ?? "";
        if (geocodeRequired && !coords && geocodeFailed) {
          return NextResponse.json(
            { ok: false, error: "No se pudo geocodificar la direccion. Verifica el texto ingresado." },
            { status: 422 }
          );
        }

        const missingTools = [
          geocodeRequired && !geocodeUsed ? "buscarCoordenadas" : null,
          coords && !reverseUsed ? "reverseGeocode" : null,
          urban ? null : "capasUrbanismo",
          flood ? null : "riesgoInundacion",
          coords ? (stats ? null : "cityStats") : null,
        ].filter(Boolean) as string[];

        if (missingTools.length) {
          const coordHint = coords ?? (hasCoords ? { lat: body.lat, lon: body.lon } : null);
          messages.push({
            role: "user",
            content: `Aun faltan tools obligatorias (${missingTools.join(
              ", "
            )}). No redactes el informe final hasta llamarlas. ${coordHint ? `Usa lat=${coordHint.lat}, lon=${coordHint.lon}.` : ""}`.trim(),
          });
          continue;
        }

        if (!hasRequiredHeadings(report_markdown)) {
          messages.push({
            role: "user",
            content:
              "El informe no cumple el formato. Devuelve SOLO el informe en Markdown con estas secciones exactas: " +
              REQUIRED_HEADINGS.map((h) => `## ${h}`).join(", "),
          });
          continue;
        }

        return NextResponse.json({
          ok: true,
          coords,
          urban,
          flood,
          stats,
          report_markdown,
          sources: SOURCES,
          limitations: limitations.length ? limitations : ["Sin incidencias destacables reportadas por las tools."],
          debug: { ...debug, reverse },
        });
      }

      for (const call of toolCalls) {
        if (call.type !== "function") continue;

        try {
          const name = call.function.name;
          let args: any = {};
          try {
            args = JSON.parse(call.function.arguments || "{}");
          } catch {
            const out = { ok: false, error: "Argumentos JSON invalidos para tool" };
            limitations.push(`Args invalidos para ${name}`);
            messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(out) });
            continue;
          }

          debug.tool_calls.push({ name, args });

          if (name === "buscarCoordenadas") {
            if (hasCoords) {
              const out = { ok: false, error: "coords ya presentes; buscarCoordenadas omitida" };
              limitations.push("Se omitio buscarCoordenadas porque el usuario ya dio coordenadas.");
              messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(out) });
              continue;
            }

            geocodeUsed = true;
            const direccion =
              typeof args.direccion === "string" && args.direccion.trim()
                ? args.direccion
                : typeof args.address === "string" && args.address.trim()
                  ? args.address
                  : typeof body.address === "string"
                    ? body.address
                    : "";

            if (!direccion) {
              const out = { ok: false, error: "Falta direccion para buscarCoordenadas" };
              geocodeFailed = true;
              limitations.push("Geocoding: no se recibio direccion valida.");
              messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(out) });
              continue;
            }

            const out = await buscarCoordenadas(direccion, "es", 1);
            if (out?.found === false) limitations.push("Geocoding: no hubo resultados en Nominatim.");
            if (out?.found === false) geocodeFailed = true;

            if (out?.found && typeof out.lat === "number" && typeof out.lon === "number") {
              coords = {
                lat: out.lat,
                lon: out.lon,
                display_name: out.display_name ?? null,
                address: out.address ?? null
              };
            } else if (out?.found) {
              geocodeFailed = true;
              limitations.push("Geocoding: respuesta sin lat/lon validos.");
            }

            messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(out) });
            continue;
          }

          if (name === "capasUrbanismo") {
            const latArg = toNumber(args.lat) ?? coords?.lat ?? (hasCoords ? body.lat : null);
            const lonArg = toNumber(args.lon) ?? coords?.lon ?? (hasCoords ? body.lon : null);
            const radiusArg = toNumber(args.radius_m) ?? radius;

            if (latArg === null || lonArg === null) {
              const out = { ok: false, error: "lat/lon invalidos para capasUrbanismo" };
              limitations.push("capasUrbanismo: lat/lon invalidos.");
              urban = out;
              messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(out) });
              continue;
            }

            const safeRadius = clampNumber(radiusArg, 200, 5000);
            const out = await capasUrbanismo(latArg, lonArg, safeRadius);
            urban = out;
            if (!coords) coords = { lat: latArg, lon: lonArg, display_name: null };

            if (out?.ign_admin?.ok === false && out?.admin_source === "ign") {
              limitations.push("IGN: no se pudo obtener unidad administrativa (best-effort).");
            }

            messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(out) });
            continue;
          }

          if (name === "riesgoInundacion") {
            const latArg = toNumber(args.lat) ?? coords?.lat ?? (hasCoords ? body.lat : null);
            const lonArg = toNumber(args.lon) ?? coords?.lon ?? (hasCoords ? body.lon : null);

            if (latArg === null || lonArg === null) {
              const out = { ok: false, error: "lat/lon invalidos para riesgoInundacion" };
              limitations.push("riesgoInundacion: lat/lon invalidos.");
              flood = out;
              messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(out) });
              continue;
            }

            const out = await riesgoInundacion(latArg, lonArg);
            flood = out;
            if (!coords) coords = { lat: latArg, lon: lonArg, display_name: null };

            if (out?.fallback_used) {
              limitations.push("Copernicus EFAS: resultado degradado/fallback (ver detalle).");
            }

            messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(out) });
            continue;
          }

          if (name === "reverseGeocode") {
            reverseUsed = true;
            const latArg = toNumber(args.lat) ?? coords?.lat ?? (hasCoords ? body.lat : null);
            const lonArg = toNumber(args.lon) ?? coords?.lon ?? (hasCoords ? body.lon : null);
            const zoomArg = toNumber(args.zoom);

            if (latArg === null || lonArg === null) {
              const out = { ok: false, error: "lat/lon invalidos para reverseGeocode" };
              limitations.push("reverseGeocode: lat/lon invalidos.");
              reverse = out;
              messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(out) });
              continue;
            }

            const out = await reverseGeocode(latArg, lonArg, zoomArg ?? 18);
            reverse = out;
            if (!coords) coords = { lat: latArg, lon: lonArg, display_name: null };
            if (out?.ok) {
              coords.display_name = out.display_name ?? coords.display_name ?? null;
              coords.address = out.address ?? coords.address ?? null;
            } else {
              limitations.push("reverseGeocode: no se pudo obtener direccion cercana.");
            }

            messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(out) });
            continue;
          }

          if (name === "cityStats") {
            const latArg = toNumber(args.lat) ?? coords?.lat ?? (hasCoords ? body.lat : null);
            const lonArg = toNumber(args.lon) ?? coords?.lon ?? (hasCoords ? body.lon : null);

            if (latArg === null || lonArg === null) {
              const out = { ok: false, error: "lat/lon invalidos para cityStats" };
              limitations.push("cityStats: lat/lon invalidos.");
              stats = out;
              messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(out) });
              continue;
            }

            const address = reverse?.address ?? coords?.address ?? null;
            const displayName = reverse?.display_name ?? coords?.display_name ?? null;
            const nameHintArg = typeof args.name_hint === "string" && args.name_hint.trim() ? args.name_hint : null;
            const nameHint =
              nameHintArg ?? pickPlaceName(address, displayName) ?? (typeof body.address === "string" ? body.address : null);
            const countryCodeArg = typeof args.country_code === "string" ? args.country_code : null;
            const countryCode = countryCodeArg ?? address?.country_code ?? null;
            const wikidataIdArg = typeof args.wikidata_id === "string" ? args.wikidata_id : null;
            const wikidataId = wikidataIdArg ?? reverse?.extratags?.wikidata ?? null;

            const out = await cityStats(latArg, lonArg, { nameHint, countryCode, wikidataId, language: "es" });
            stats = out;
            if (!coords) coords = { lat: latArg, lon: lonArg, display_name: displayName ?? null };

            if (!out?.ok) {
              limitations.push("Poblacion/superficie: no se pudieron obtener datos.");
            } else {
              if (out?.city?.population == null) limitations.push("Poblacion: no disponible en fuentes.");
              if (out?.city?.area_km2 == null) limitations.push("Superficie: no disponible en fuentes.");
              if (out?.city?.area_estimated) limitations.push("Superficie: valor estimado por unidad no explicita.");
            }

            messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(out) });
            continue;
          }

          const out = { ok: false, error: `Tool desconocida: ${name}` };
          limitations.push(`Tool desconocida solicitada por el modelo: ${name}`);
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(out) });
        } catch (e: any) {
          const out = { ok: false, error: e?.message ?? "Error ejecutando tool" };
          if (call.type === "function") {
            if (call.function.name === "capasUrbanismo") urban = out;
            if (call.function.name === "riesgoInundacion") flood = out;
            if (call.function.name === "reverseGeocode") reverse = out;
            if (call.function.name === "cityStats") stats = out;
            if (call.function.name === "buscarCoordenadas") geocodeFailed = true;
          }
          limitations.push(`${call.function.name} fallo: ${out.error}`);
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(out) });
        }
      }

      if (geocodeRequired && !coords && geocodeFailed) {
        return NextResponse.json(
          { ok: false, error: "No se pudo geocodificar la direccion. Verifica el texto ingresado." },
          { status: 422 }
        );
      }
    }

    return NextResponse.json(
      { ok: false, error: "El modelo no finalizo el informe (demasiados pasos)", debug },
      { status: 500 }
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Error en analyze" }, { status: 500 });
  }
}
