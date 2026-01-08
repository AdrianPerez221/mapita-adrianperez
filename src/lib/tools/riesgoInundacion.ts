import { env } from "@/lib/env";
import { fetchWithTimeout } from "@/lib/fetch";
import { XMLParser } from "fast-xml-parser";
import { bboxAround } from "@/lib/geo";

function safeArray<T>(x: T | T[] | undefined): T[] {
  if (!x) return [];
  return Array.isArray(x) ? x : [x];
}

export async function riesgoInundacion(lat: number, lon: number) {
  const capabilitiesUrl =
    env.COPERNICUS_EFAS_WMS_URL ??
    "https://european-flood.emergency.copernicus.eu/api/wms/?request=getcapabilities";

  // 1) GetCapabilities
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

  // 2) Parse
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" });
  const cap = parser.parse(capXml);

  const capability = cap?.WMS_Capabilities?.Capability ?? cap?.WMT_MS_Capabilities?.Capability;
  const rootLayer = capability?.Layer;

  // Recolecta layers “queryable”
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
      reason: "No se encontró layer usable en capabilities",
      layers_seen: allLayers.slice(0, 30),
      fallback_used: true
    };
  }

  // 3) Construir GetFeatureInfo “mínimo”
  // OJO: WMS 1.3.0 + EPSG:4326 suele usar orden lat,lon en BBOX.
  const bb = bboxAround(lat, lon, 0.02);
  const baseWms = new URL(capabilitiesUrl);
  // quita request=getcapabilities y deja base endpoint
  baseWms.searchParams.set("service", "WMS");
  baseWms.searchParams.set("version", "1.3.0");
  baseWms.searchParams.set("request", "GetFeatureInfo");

  baseWms.searchParams.set("crs", "EPSG:4326");
  baseWms.searchParams.set("bbox", `${bb.minLat},${bb.minLon},${bb.maxLat},${bb.maxLon}`);
  baseWms.searchParams.set("width", "101");
  baseWms.searchParams.set("height", "101");
  baseWms.searchParams.set("i", "50");
  baseWms.searchParams.set("j", "50");

  baseWms.searchParams.set("layers", pick.Name);
  baseWms.searchParams.set("query_layers", pick.Name);

  // Muchos WMS devuelven GML/HTML; intentamos GML primero
  baseWms.searchParams.set("info_format", "application/vnd.ogc.gml");

  let featureInfoText: string | null = null;
  let featureInfoOk = false;

  try {
    const fiRes = await fetchWithTimeout(baseWms, { timeoutMs: 15000 });
    featureInfoOk = fiRes.ok;
    featureInfoText = await fiRes.text();
  } catch (e: any) {
    featureInfoOk = false;
    featureInfoText = e?.message ?? "GetFeatureInfo falló";
  }

  // Si no trae nada útil, devolvemos capabilities + nota (fallback transparente)
  const looksEmpty =
    !featureInfoOk || !featureInfoText || featureInfoText.length < 50;

  return {
    ok: !looksEmpty,
    method: "copernicus_efas_wms",
    layer: { name: pick.Name, title: pick.Title ?? null },
    getfeatureinfo_url: baseWms.toString(),
    feature_info: looksEmpty ? null : featureInfoText,
    note: looksEmpty
      ? "EFAS WMS respondió vacío/no interpretable para ese punto. Se adjunta layer seleccionado + URL de consulta."
      : "Respuesta devuelta por EFAS WMS (GML/Texto).",
    fallback_used: looksEmpty,
    layers_sample: allLayers.slice(0, 20)
  };
}
