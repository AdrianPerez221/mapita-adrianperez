import { env } from "@/lib/env";
import { fetchWithTimeout } from "@/lib/fetch";
import { XMLParser } from "fast-xml-parser";
import { bboxAround } from "@/lib/geo";

function safeArray<T>(x: T | T[] | undefined): T[] {
  if (!x) return [];
  return Array.isArray(x) ? x : [x];
}

function cleanText(raw: string) {
  return raw.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function looksLikeServiceException(raw: string) {
  return /ServiceException|ExceptionReport|Exception/i.test(raw);
}

function tryParseJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function tryParseXml(text: string) {
  try {
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" });
    return parser.parse(text);
  } catch {
    return null;
  }
}

function summarizeParsed(parsed: any) {
  try {
    const raw = JSON.stringify(parsed);
    return raw.length > 1800 ? `${raw.slice(0, 1800)}...` : raw;
  } catch {
    return null;
  }
}

export async function riesgoInundacion(lat: number, lon: number) {
  const capabilitiesUrl =
    env.COPERNICUS_EFAS_WMS_URL ??
    "https://european-flood.emergency.copernicus.eu/api/wms/?request=getcapabilities";

  const capRes = await fetchWithTimeout(capabilitiesUrl, { timeoutMs: 15000 });
  if (!capRes.ok) {
    return {
      ok: false,
      method: "copernicus_wms",
      reason: `GetCapabilities HTTP ${capRes.status}`,
      note: "No se pudo consultar EFAS WMS",
      fallback_used: true
    };
  }

  const capXml = await capRes.text();
  const capParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" });
  const cap = capParser.parse(capXml);

  const capability = cap?.WMS_Capabilities?.Capability ?? cap?.WMT_MS_Capabilities?.Capability;
  const rootLayer = capability?.Layer;

  const allLayers: { Name?: string; Title?: string; queryable?: string }[] = [];
  const walk = (layer: any) => {
    if (!layer) return;
    if (layer.Name || layer.Title) allLayers.push({ Name: layer.Name, Title: layer.Title, queryable: layer.queryable });
    for (const child of safeArray(layer.Layer)) walk(child);
  };
  walk(rootLayer);

  const queryable = allLayers.filter((l) => l.Name && String(l.queryable) === "1");
  const pick =
    queryable.find((l) => /flood|inund|risk|rp/i.test(l.Name!)) ??
    queryable[0] ??
    allLayers.find((l) => l.Name) ??
    null;

  if (!pick?.Name) {
    return {
      ok: false,
      method: "copernicus_wms",
      reason: "No se encontro layer usable en capabilities",
      layers_seen: allLayers.slice(0, 30),
      fallback_used: true
    };
  }

  const bb = bboxAround(lat, lon, 0.02);
  const formatCandidates = [
    "application/json",
    "application/vnd.ogc.gml",
    "text/plain",
    "text/html"
  ];

  const variants = [
    {
      version: "1.3.0",
      crsKey: "crs",
      bbox: `${bb.minLat},${bb.minLon},${bb.maxLat},${bb.maxLon}`,
      iKey: "i",
      jKey: "j",
      axis: "latlon"
    },
    {
      version: "1.1.1",
      crsKey: "srs",
      bbox: `${bb.minLon},${bb.minLat},${bb.maxLon},${bb.maxLat}`,
      iKey: "x",
      jKey: "y",
      axis: "lonlat"
    }
  ];

  const base = new URL(capabilitiesUrl);
  let best: {
    url: string;
    format: string;
    raw: string;
    parsed: any;
    summary: string;
    axis: string;
  } | null = null;

  for (const variant of variants) {
    for (const format of formatCandidates) {
      const url = new URL(base.toString());
      url.searchParams.set("service", "WMS");
      url.searchParams.set("version", variant.version);
      url.searchParams.set("request", "GetFeatureInfo");
      url.searchParams.set(variant.crsKey, "EPSG:4326");
      url.searchParams.set("bbox", variant.bbox);
      url.searchParams.set("width", "101");
      url.searchParams.set("height", "101");
      url.searchParams.set(variant.iKey, "50");
      url.searchParams.set(variant.jKey, "50");
      url.searchParams.set("layers", pick.Name);
      url.searchParams.set("query_layers", pick.Name);
      url.searchParams.set("info_format", format);

      try {
        const res = await fetchWithTimeout(url, { timeoutMs: 15000 });
        const text = await res.text();
        if (!res.ok) continue;
        if (!text || text.length < 20 || looksLikeServiceException(text)) continue;

        const contentType = res.headers.get("content-type") ?? "";
        let parsed: any = null;

        if (format.includes("json") || contentType.includes("json") || text.trim().startsWith("{")) {
          parsed = tryParseJson(text);
        }
        if (!parsed && (format.includes("gml") || contentType.includes("xml") || text.trim().startsWith("<"))) {
          parsed = tryParseXml(text);
        }

        const summary = parsed ? summarizeParsed(parsed) : cleanText(text);
        if (!summary || summary.length < 20) continue;

        best = {
          url: url.toString(),
          format,
          raw: text,
          parsed,
          summary,
          axis: variant.axis
        };
        break;
      } catch {
        continue;
      }
    }

    if (best) break;
  }

  if (!best) {
    return {
      ok: false,
      method: "copernicus_efas_wms",
      layer: { name: pick.Name, title: pick.Title ?? null },
      note: "EFAS WMS respondio vacio o con error para ese punto.",
      fallback_used: true,
      layers_sample: allLayers.slice(0, 20)
    };
  }

  return {
    ok: true,
    method: "copernicus_efas_wms",
    layer: { name: pick.Name, title: pick.Title ?? null },
    getfeatureinfo_url: best.url,
    info_format: best.format,
    feature_info: best.raw,
    parsed: best.parsed ?? null,
    summary: best.summary,
    axis_order: best.axis,
    note: "Respuesta devuelta por EFAS WMS.",
    fallback_used: false,
    layers_sample: allLayers.slice(0, 20)
  };
}
