import { NextResponse } from "next/server";
import { z } from "zod";
import { openai } from "@/lib/openai";
import { env } from "@/lib/env";

import { buscarCoordenadas } from "@/lib/tools/buscarCoordenadas";
import { capasUrbanismo } from "@/lib/tools/capasUrbanismo";
import { riesgoInundacion } from "@/lib/tools/riesgoInundacion";

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
  { name: "Copernicus EFAS WMS", url: "https://european-flood.emergency.copernicus.eu/api/wms/" },
];

function systemPrompt() {
  return `
Eres un analista GIS.
REGLAS DURAS:
- Debes usar SOLO los datos devueltos por las tools.
- No inventes fuentes ni datos.
- Si una tool falla o no hay cobertura: dilo en "Limitaciones".
- Si el usuario ya manda lat/lon: NO llames buscarCoordenadas.
- Siempre llama capasUrbanismo y riesgoInundacion antes de redactar el informe final.

Devuelve el informe en Markdown con estas secciones exactas:
## Descripción de zona
## Infraestructura cercana
## Riesgos relevantes
## Posibles usos urbanos
## Recomendación final
## Fuentes consultadas
## Limitaciones

Bibliografía permitida (usa solo estas):
${SOURCES.map((s) => `- ${s.name}: ${s.url}`).join("\n")}
`.trim();
}

export async function POST(req: Request) {
  try {
    const body = BodySchema.parse(await req.json());
    const radius = body.radius_m ?? 1200;

    const hasCoords = typeof body.lat === "number" && typeof body.lon === "number";
    const hasAddress = typeof body.address === "string" && body.address.trim().length > 0;

    if (!hasCoords && !hasAddress) {
      return NextResponse.json({ ok: false, error: "Debes enviar address o lat/lon" }, { status: 400 });
    }

    // Tool defs (lo dejamos en any[] para evitar fricción de typings en clase)
    const tools: any[] = [
      {
        type: "function",
        function: {
          name: "buscarCoordenadas",
          description: "Convierte una dirección en coordenadas usando Nominatim (OpenStreetMap).",
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
          description: "Consulta riesgo/indicadores de inundación (Copernicus EFAS WMS).",
          parameters: {
            type: "object",
            properties: { lat: { type: "number" }, lon: { type: "number" } },
            required: ["lat", "lon"],
            additionalProperties: false,
          },
        },
      },
    ];

    // Mensajes iniciales
    const messages: any[] = [
      { role: "system", content: systemPrompt() },
      {
        role: "user",
        content: hasCoords
          ? `El usuario seleccionó un punto en el mapa: lat=${body.lat}, lon=${body.lon}. Ejecuta capasUrbanismo y riesgoInundacion.`
          : `El usuario escribió una dirección: "${body.address}". Primero usa buscarCoordenadas; luego usa capasUrbanismo y riesgoInundacion.`,
      },
    ];

    // Para devolver al frontend
    let coords: any = hasCoords ? { lat: body.lat!, lon: body.lon!, display_name: null } : null;
    let urban: any = null;
    let flood: any = null;

    const limitations: string[] = [];
    const debug: any = { tool_calls: [] };

    // loop tool-calling (máx 5 vueltas)
    for (let step = 0; step < 5; step++) {
      const completion = await openai.chat.completions.create({
        model: env.OPENAI_MODEL,
        messages,
        tools,
        tool_choice: "auto",
        temperature: 0.2,
      });

      const msg = completion.choices[0]?.message;
      if (!msg) throw new Error("OpenAI no devolvió message");

      // guardamos el mensaje del asistente (puede traer tool_calls o content final)
      messages.push(msg);

      const toolCalls = msg.tool_calls ?? [];

      // Si no hay tool calls, el content es el informe final
      if (!toolCalls.length) {
        const report_markdown = msg.content ?? "";
        return NextResponse.json({
          ok: true,
          coords,
          urban,
          flood,
          report_markdown,
          sources: SOURCES,
          limitations: limitations.length ? limitations : ["Sin incidencias destacables reportadas por las tools."],
          debug,
        });
      }

      // Ejecutar tool calls
      for (const call of toolCalls) {
        // ✅ FIX: Narrowing para evitar error TS "call.function no existe"
        if (call.type !== "function") continue;

        const name = call.function.name;
        const args = JSON.parse(call.function.arguments || "{}");

        debug.tool_calls.push({ name, args });

        try {
          if (name === "buscarCoordenadas") {
            if (hasCoords) {
              const out = { ok: false, error: "coords ya presentes; buscarCoordenadas omitida" };
              limitations.push("Se omitió buscarCoordenadas porque el usuario ya dio coordenadas.");
              messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(out) });
              continue;
            }

            const out = await buscarCoordenadas(args.direccion, "es", 1);
            if (out?.found === false) limitations.push("Geocoding: no hubo resultados en Nominatim.");

            if (out?.found && typeof out.lat === "number" && typeof out.lon === "number") {
              coords = { lat: out.lat, lon: out.lon, display_name: out.display_name ?? null };
            }

            messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(out) });
            continue;
          }

          if (name === "capasUrbanismo") {
            const out = await capasUrbanismo(args.lat, args.lon, args.radius_m ?? radius);
            urban = out;

            if (out?.ign_admin?.ok === false) {
              limitations.push("IGN: no se pudo obtener unidad administrativa (best-effort).");
            }

            messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(out) });
            continue;
          }

          if (name === "riesgoInundacion") {
            const out = await riesgoInundacion(args.lat, args.lon);
            flood = out;

            if (out?.fallback_used) {
              limitations.push("Copernicus EFAS: resultado degradado/fallback (ver detalle).");
            }

            messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(out) });
            continue;
          }

          // Tool desconocida
          const out = { ok: false, error: `Tool desconocida: ${name}` };
          limitations.push(`Tool desconocida solicitada por el modelo: ${name}`);
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(out) });
        } catch (e: any) {
          const out = { ok: false, error: e?.message ?? "Error ejecutando tool" };
          limitations.push(`${name} falló: ${out.error}`);
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(out) });
        }
      }
    }

    // Si llega aquí, no terminó
    return NextResponse.json(
      { ok: false, error: "El modelo no finalizó el informe (demasiados pasos)", debug },
      { status: 500 }
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Error en analyze" }, { status: 500 });
  }
}
