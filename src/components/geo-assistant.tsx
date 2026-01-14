"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import dynamic from "next/dynamic";
import ReportView from "@/components/report-view";
import CompareView from "@/components/compare-view";
import HistoryView from "@/components/history-view";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import type { AnalyzeResponse, CompareResponse, HistoryResponse } from "@/lib/types";

type MapStyle = "standard" | "satellite" | "pollution";
type Mode = "analyze" | "compare" | "historic";
type LocationInfo = {
  display_name?: string | null;
  address?: Record<string, string> | null;
};
type ComparePoint = {
  id: "A" | "B";
  coords: { lat: number; lon: number };
  locationName?: string | null;
  locationLines?: string[];
  address?: Record<string, string> | null;
};
type SavedLocation = {
  id: string;
  name: string;
  coords: { lat: number; lon: number };
  display_name?: string | null;
  address?: Record<string, string> | null;
  notes?: string | null;
  created_at: string;
};

function buildAddressLines(address: Record<string, string> | null | undefined) {
  if (!address) return [];
  const road = address.road || address.pedestrian || address.footway || address.path;
  const house = address.house_number;
  const neighborhood = address.neighbourhood || address.suburb || address.quarter || address.city_district || address.district;
  const locality = address.city || address.town || address.village || address.municipality || address.hamlet;
  const region = address.state || address.province || address.region || address.state_district;
  const country = address.country;
  const postcode = address.postcode;

  const lines = [];
  if (road) lines.push(`Calle: ${house ? `${road} ${house}` : road}`);
  if (neighborhood) lines.push(`Zona: ${neighborhood}`);
  if (locality) lines.push(`Municipio: ${locality}`);
  if (region) lines.push(`Comunidad/Provincia: ${region}`);
  if (postcode) lines.push(`CP: ${postcode}`);
  if (country) lines.push(`Pais: ${country}`);
  return lines;
}

const MapView = dynamic(() => import("@/components/map-view"), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full flex items-center justify-center text-sm text-muted-foreground">
      Cargando mapa...
    </div>
  ),
});

export default function GeoAssistant() {
  const storageKey = "geoai_saved_locations";
  const savedFocusZoom = 17;
  const [address, setAddress] = useState("");
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [mapStyle, setMapStyle] = useState<MapStyle>("standard");
  const [mode, setMode] = useState<Mode>("analyze");
  const [showFloodLayer, setShowFloodLayer] = useState(false);
  const [location, setLocation] = useState<LocationInfo | null>(null);
  const [panRequestId, setPanRequestId] = useState(0);
  const [panZoom, setPanZoom] = useState<number | null>(null);
  const [comparePoints, setComparePoints] = useState<ComparePoint[]>([]);

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<AnalyzeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareData, setCompareData] = useState<CompareResponse | null>(null);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyData, setHistoryData] = useState<HistoryResponse | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [savedLocations, setSavedLocations] = useState<SavedLocation[]>([]);
  const [saveSourceId, setSaveSourceId] = useState("");
  const [saveName, setSaveName] = useState("");
  const [saveNotes, setSaveNotes] = useState("");

  async function fetchReverseInfo(lat: number, lon: number) {
    try {
      const res = await fetch("/api/reverse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ lat, lon, zoom: 18 })
      });
      const json = await res.json();
      if (!res.ok || json?.ok === false) return null;
      return {
        display_name: (json?.display_name as string | null) ?? null,
        address: (json?.address as Record<string, string> | null) ?? null
      };
    } catch {
      return null;
    }
  }

  function createSavedId() {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function handleSaveLocation() {
    const source = saveSources.find((s) => s.id === saveSourceId);
    if (!source) {
      toast.error("Selecciona una ubicacion valida");
      return;
    }
    const name = saveName.trim() || source.display_name || source.label;
    const next: SavedLocation = {
      id: createSavedId(),
      name,
      coords: source.coords,
      display_name: source.display_name ?? null,
      address: source.address ?? null,
      notes: saveNotes.trim() ? saveNotes.trim() : null,
      created_at: new Date().toISOString(),
    };
    setSavedLocations((prev) => [next, ...prev]);
    setSaveNotes("");
    toast.success("Ubicacion guardada");
  }

  function handleSavedNote(id: string, notes: string) {
    setSavedLocations((prev) =>
      prev.map((item) => (item.id === id ? { ...item, notes } : item))
    );
  }

  function handleDeleteSaved(id: string) {
    setSavedLocations((prev) => prev.filter((item) => item.id !== id));
  }

  function handleGoToSaved(item: SavedLocation) {
    setMode("analyze");
    setCoords(item.coords);
    setLocation({
      display_name: item.display_name ?? null,
      address: item.address ?? null,
    });
    setAddress("");
    setData(null);
    setError(null);
    setPanZoom(savedFocusZoom);
    setPanRequestId((id) => id + 1);
  }

  const canAnalyze = useMemo(() => Boolean(address.trim()) || Boolean(coords), [address, coords]);
  const canHistory = canAnalyze;
  const addressLines = useMemo(() => buildAddressLines(location?.address), [location?.address]);
  const canCompare = comparePoints.length === 2;
  const compareA = comparePoints.find((p) => p.id === "A") ?? null;
  const compareB = comparePoints.find((p) => p.id === "B") ?? null;
  const saveSources = useMemo(() => {
    const sources: {
      id: string;
      label: string;
      coords: { lat: number; lon: number };
      display_name?: string | null;
      address?: Record<string, string> | null;
    }[] = [];

    if ((mode === "analyze" || mode === "historic") && coords) {
      const label = location?.display_name ?? `Ubicacion actual (${coords.lat.toFixed(5)}, ${coords.lon.toFixed(5)})`;
      sources.push({
        id: "analysis",
        label,
        coords,
        display_name: location?.display_name ?? null,
        address: location?.address ?? null
      });
    }

    if (compareA) {
      sources.push({
        id: "compare-A",
        label: `Ciudad A: ${compareA.locationName ?? `${compareA.coords.lat.toFixed(5)}, ${compareA.coords.lon.toFixed(5)}`}`,
        coords: compareA.coords,
        display_name: compareA.locationName ?? null,
        address: compareA.address ?? null
      });
    }

    if (compareB) {
      sources.push({
        id: "compare-B",
        label: `Ciudad B: ${compareB.locationName ?? `${compareB.coords.lat.toFixed(5)}, ${compareB.coords.lon.toFixed(5)}`}`,
        coords: compareB.coords,
        display_name: compareB.locationName ?? null,
        address: compareB.address ?? null
      });
    }

    return sources;
  }, [mode, coords, location?.display_name, location?.address, compareA, compareB]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as SavedLocation[];
      if (Array.isArray(parsed)) setSavedLocations(parsed);
    } catch {
      return;
    }
  }, [storageKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(savedLocations));
    } catch {
      return;
    }
  }, [savedLocations, storageKey]);

  useEffect(() => {
    if (!saveSources.length) {
      setSaveSourceId("");
      setSaveName("");
      return;
    }
    if (!saveSourceId || !saveSources.some((s) => s.id === saveSourceId)) {
      setSaveSourceId(saveSources[0].id);
    }
  }, [saveSources, saveSourceId]);

  useEffect(() => {
    const source = saveSources.find((s) => s.id === saveSourceId);
    if (!source) {
      setSaveName("");
      return;
    }
    setSaveName(source.display_name ?? source.label);
  }, [saveSourceId, saveSources]);

  async function analyze(payload: { address?: string; lat?: number; lon?: number }) {
    setLoading(true);
    setError(null);
    setData(null);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          address: payload.address ?? null,
          lat: payload.lat ?? null,
          lon: payload.lon ?? null,
          radius_m: 1200
        })
      });

      const json = (await res.json()) as AnalyzeResponse;

      if (!res.ok) {
        throw new Error(json?.error ?? "Error desconocido en /api/analyze");
      }

      let nextData = json;
      if (json.coords && (!json.coords.display_name || !json.coords.address)) {
        const reverseInfo = await fetchReverseInfo(json.coords.lat, json.coords.lon);
        if (reverseInfo) {
          nextData = {
            ...json,
            coords: {
              ...json.coords,
              display_name: reverseInfo.display_name ?? json.coords.display_name ?? null,
              address: reverseInfo.address ?? json.coords.address ?? null
            }
          };
        }
      }

      setData(nextData);
      if (nextData.coords) {
        setCoords({ lat: nextData.coords.lat, lon: nextData.coords.lon });
        setLocation({
          display_name: nextData.coords.display_name ?? null,
          address: nextData.coords.address ?? null
        });
        if (payload.address) {
          setPanZoom(null);
          setPanRequestId((id) => id + 1);
        }
      }
      toast.success("Informe generado");
    } catch (e: any) {
      const msg = e?.message ?? "Fallo el analisis";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  async function analyzeHistory(payload: { address?: string; lat?: number; lon?: number }) {
    setHistoryLoading(true);
    setHistoryError(null);
    setHistoryData(null);

    try {
      const res = await fetch("/api/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          address: payload.address ?? null,
          lat: payload.lat ?? null,
          lon: payload.lon ?? null,
        })
      });

      const json = (await res.json()) as HistoryResponse;
      if (!res.ok || json?.ok === false) {
        throw new Error(json?.error ?? "Error desconocido en /api/history");
      }

      setHistoryData(json);
      if (json.coords) {
        setCoords({ lat: json.coords.lat, lon: json.coords.lon });
        setLocation({
          display_name: json.coords.display_name ?? null,
          address: json.coords.address ?? null
        });
        if (payload.address) {
          setPanZoom(null);
          setPanRequestId((id) => id + 1);
        }
      }
      toast.success("Informe historico generado");
    } catch (e: any) {
      const msg = e?.message ?? "Fallo el analisis historico";
      setHistoryError(msg);
      toast.error(msg);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function compareCities() {
    if (comparePoints.length < 2) return;
    setCompareLoading(true);
    setCompareError(null);
    setCompareData(null);

    try {
      const res = await fetch("/api/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          a: { lat: comparePoints[0].coords.lat, lon: comparePoints[0].coords.lon },
          b: { lat: comparePoints[1].coords.lat, lon: comparePoints[1].coords.lon }
        })
      });
      const json = await res.json();
      if (!res.ok || json?.ok === false) {
        throw new Error(json?.error ?? "Error desconocido en /api/compare");
      }
      let nextCompare = json as CompareResponse;
      const ensureCityReverse = async (city: any | null | undefined) => {
        if (!city?.coords) return city ?? null;
        const hasName = Boolean(city.reverse?.display_name);
        const hasAddress = Boolean(city.reverse?.address);
        if (hasName && hasAddress) return city;
        const reverseInfo = await fetchReverseInfo(city.coords.lat, city.coords.lon);
        if (!reverseInfo) return city;
        return {
          ...city,
          reverse: {
            ...(city.reverse ?? {}),
            ok: true,
            display_name: reverseInfo.display_name ?? city.reverse?.display_name ?? null,
            address: reverseInfo.address ?? city.reverse?.address ?? null
          }
        };
      };

      const [cityA, cityB] = await Promise.all([
        ensureCityReverse(nextCompare.cityA ?? null),
        ensureCityReverse(nextCompare.cityB ?? null)
      ]);
      nextCompare = { ...nextCompare, cityA, cityB };
      setCompareData(nextCompare);
      if (comparePoints.length === 2) {
        setComparePoints((prev) =>
          prev.map((point) => {
            const city = point.id === "A" ? cityA : cityB;
            const address = city?.reverse?.address ?? point.address ?? null;
            const locationName = city?.reverse?.display_name ?? point.locationName ?? null;
            const lines = address ? buildAddressLines(address) : point.locationLines ?? [];
            return {
              ...point,
              locationName,
              locationLines: lines,
              address
            };
          })
        );
      }
      toast.success("Comparacion generada");
    } catch (e: any) {
      const msg = e?.message ?? "Fallo la comparacion";
      setCompareError(msg);
      toast.error(msg);
    } finally {
      setCompareLoading(false);
    }
  }

  async function handlePick(p: { lat: number; lon: number }) {
    setPanZoom(null);
    if (mode === "compare") {
      const slot = comparePoints.length === 0 ? "A" : "B";
      try {
        setCompareError(null);
        const res = await fetch("/api/reverse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({ lat: p.lat, lon: p.lon })
        });
        const json = await res.json();
        if (!res.ok || json?.ok === false) {
          throw new Error(json?.error ?? "No se pudo obtener ciudad cercana");
        }
        const displayName = json?.display_name ?? null;
        const address = json?.address ?? null;
        const lines = buildAddressLines(address);
        const next: ComparePoint = {
          id: slot,
          coords: p,
          locationName: displayName,
          locationLines: lines,
          address
        };

        setCompareData(null);
        setComparePoints((prev) => {
          if (prev.length === 0) return [next];
          if (prev.length === 1) return [prev[0], { ...next, id: "B" }];
          return [prev[0], { ...next, id: "B" }];
        });

        toast.message(slot === "A" ? "Ciudad A seleccionada" : "Ciudad B seleccionada", {
          description: displayName ?? `${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}`
        });
        return;
      } catch (e: any) {
        toast.error(e?.message ?? "No se pudo obtener ciudad cercana");
        return;
      }
    }

    setCoords(p);
    setLocation(null);
    if (mode === "historic") {
      setHistoryData(null);
      setHistoryError(null);
    }
    try {
      const res = await fetch("/api/reverse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ lat: p.lat, lon: p.lon })
      });
      const json = await res.json();
      if (res.ok && json?.ok) {
        const displayName = json?.display_name ?? null;
        const address = json?.address ?? null;
        const lines = buildAddressLines(address);
        setLocation({ display_name: displayName, address });
        const descriptionParts = [displayName, ...lines].filter(Boolean);
        toast.message("Punto seleccionado", {
          description: descriptionParts.length
            ? descriptionParts.join(" | ")
            : `${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}`
        });
        return;
      }
      toast.error(json?.error ?? "No se pudo obtener direccion cercana");
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo obtener direccion cercana");
    }

    toast.message("Punto seleccionado", {
      description: `${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}`
    });
  }

  return (
    <TooltipProvider>
      <div className="h-full w-full grid grid-cols-1 lg:grid-cols-[420px_1fr]">
        <div className="relative h-full border-r border-white/60 bg-white/70 backdrop-blur-xl supports-[backdrop-filter]:bg-white/60 p-5 overflow-y-auto shadow-[0_18px_60px_rgba(15,23,42,0.14)]">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-white/80 to-transparent" />
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight font-display">GeoAI Assistant</h1>
              <p className="text-sm text-muted-foreground">
                Busca una direccion o marca un punto para ver datos cercanos.
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            <Card className="p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Modo</div>
              </div>
              <Tabs value={mode} onValueChange={(value) => setMode(value as Mode)}>
                <TabsList className="grid grid-cols-3">
                  <TabsTrigger value="analyze">Analisis</TabsTrigger>
                  <TabsTrigger value="compare">Comparar</TabsTrigger>
                  <TabsTrigger value="historic">Historico</TabsTrigger>
                </TabsList>
              </Tabs>
              <div className="text-xs text-muted-foreground">
                {mode === "analyze"
                  ? "Analiza una direccion o un punto del mapa."
                  : mode === "compare"
                    ? "Selecciona dos ciudades haciendo click en el mapa."
                    : "Informe historico de los ultimos 5 anos para la zona seleccionada."}
              </div>
            </Card>

            {(mode === "analyze" || mode === "historic") && (
            <Card className="p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Entrada</div>
              </div>

              <div className="flex items-center gap-2">
                <Input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Escribe una direccion (ej: Calle X, Valencia)"
                />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      onClick={() => {
                        if (mode === "historic") analyzeHistory({ address });
                        else analyze({ address });
                      }}
                      disabled={(mode === "historic" ? historyLoading : loading) || !address.trim()}
                    >
                      Buscar
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top" align="center" sideOffset={6}>
                    Geocoding OSM
                  </TooltipContent>
                </Tooltip>
              </div>

              <div className="flex items-start justify-between text-xs text-muted-foreground">
                <div>
                  {coords ? (
                    <div className="text-foreground">
                      Coordenadas:{" "}
                      <span className="font-medium">
                        {coords.lat.toFixed(6)}, {coords.lon.toFixed(6)}
                      </span>
                    </div>
                  ) : (
                    <div>Tip: tambien puedes hacer click en el mapa</div>
                  )}
                  {location?.display_name && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      {location.display_name}
                    </div>
                  )}
                  {addressLines.length > 0 && (
                    <div className="mt-1 space-y-1 text-xs text-muted-foreground">
                      {addressLines.map((line) => (
                        <div key={line}>{line}</div>
                      ))}
                    </div>
                  )}
                </div>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setAddress("");
                        setCoords(null);
                        setLocation(null);
                        setData(null);
                        setError(null);
                        setHistoryData(null);
                        setHistoryError(null);
                        setPanZoom(null);
                        toast("Listo: estado reiniciado");
                      }}
                    >
                      Reset
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top" align="center" sideOffset={6}>
                    Reinicia todo
                  </TooltipContent>
                </Tooltip>
              </div>
            </Card>
            )}

            <Card className="p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Vista de mapa</div>
              </div>
              <Tabs value={mapStyle} onValueChange={(value) => setMapStyle(value as MapStyle)}>
                <TabsList className="grid grid-cols-3">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <TabsTrigger value="standard">Mapa</TabsTrigger>
                    </TooltipTrigger>
                    <TooltipContent side="top" align="center" sideOffset={6}>
                      Mapa base
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <TabsTrigger value="satellite">Satelite</TabsTrigger>
                    </TooltipTrigger>
                    <TooltipContent side="top" align="center" sideOffset={6}>
                      Vista satelite
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <TabsTrigger value="pollution">Contaminacion</TabsTrigger>
                    </TooltipTrigger>
                    <TooltipContent side="top" align="center" sideOffset={6}>
                      Aerosoles
                    </TooltipContent>
                  </Tooltip>
                </TabsList>
              </Tabs>
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>Etiqueta y capas disponibles</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant={showFloodLayer ? "default" : "secondary"}
                      onClick={() => setShowFloodLayer((prev) => !prev)}
                    >
                      {showFloodLayer ? "Ocultar inundacion" : "Mostrar inundacion"}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top" align="center" sideOffset={6}>
                    Capa inundacion EFAS
                  </TooltipContent>
                </Tooltip>
              </div>
            </Card>

            {mode === "analyze" && (
              <Card className="p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Analisis</div>
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      className="w-full"
                      disabled={loading || !canAnalyze}
                      onClick={() => {
                        if (coords) analyze({ lat: coords.lat, lon: coords.lon });
                        else analyze({ address });
                      }}
                    >
                      Analizar zona
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top" align="center" sideOffset={6}>
                    Genera informe
                  </TooltipContent>
                </Tooltip>
                <div className="text-xs text-muted-foreground">
                  Usa direccion o selecciona un punto en el mapa.
                </div>
              </Card>
            )}

            {mode === "historic" && (
              <Card className="p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Historico</div>
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      className="w-full"
                      disabled={historyLoading || !canHistory}
                      onClick={() => {
                        if (coords) analyzeHistory({ lat: coords.lat, lon: coords.lon });
                        else analyzeHistory({ address });
                      }}
                    >
                      Analizar historico
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top" align="center" sideOffset={6}>
                    Genera informe historico
                  </TooltipContent>
                </Tooltip>
                <div className="text-xs text-muted-foreground">
                  Ultimos 5 anos con clima y eventos reportados.
                </div>
              </Card>
            )}

            {mode === "compare" && (
              <Card className="p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Comparacion</div>
                </div>
                <div className="space-y-2">
                  <div className="rounded-md border p-2">
                    <div className="text-xs font-semibold">Ciudad A</div>
                    {compareA ? (
                      <div className="mt-1 space-y-1 text-xs text-muted-foreground">
                        <div>{compareA.locationName ?? "Sin nombre"}</div>
                        {compareA.locationLines?.map((line) => (
                          <div key={line}>{line}</div>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-1 text-xs text-muted-foreground">Click para seleccionar</div>
                    )}
                  </div>
                  <div className="rounded-md border p-2">
                    <div className="text-xs font-semibold">Ciudad B</div>
                    {compareB ? (
                      <div className="mt-1 space-y-1 text-xs text-muted-foreground">
                        <div>{compareB.locationName ?? "Sin nombre"}</div>
                        {compareB.locationLines?.map((line) => (
                          <div key={line}>{line}</div>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-1 text-xs text-muted-foreground">Click para seleccionar</div>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-2">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setComparePoints([]);
                          setCompareData(null);
                          setCompareError(null);
                        }}
                      >
                        Limpiar
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top" align="center" sideOffset={6}>
                      Borra seleccion
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        className="w-full whitespace-normal leading-tight"
                        disabled={compareLoading || !canCompare}
                        onClick={compareCities}
                      >
                        Comparar ciudades
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top" align="center" sideOffset={6}>
                      Genera informe VS
                    </TooltipContent>
                  </Tooltip>
                </div>
              </Card>
            )}

            <Card className="p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Ubicaciones guardadas
                </div>
              </div>
              <div className="space-y-2">
                <div className="text-xs text-muted-foreground">
                  Guarda una ubicacion y agrega notas o comentarios.
                </div>
                <div className="space-y-2">
                  <select
                    className="h-9 w-full rounded-md border bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    value={saveSourceId}
                    onChange={(e) => setSaveSourceId(e.target.value)}
                    disabled={saveSources.length === 0}
                  >
                    {saveSources.length === 0 ? (
                      <option value="">No hay ubicaciones para guardar</option>
                    ) : (
                      saveSources.map((source) => (
                        <option key={source.id} value={source.id}>
                          {source.label}
                        </option>
                      ))
                    )}
                  </select>
                  <Input
                    value={saveName}
                    onChange={(e) => setSaveName(e.target.value)}
                    placeholder="Nombre de la ubicacion"
                    disabled={saveSources.length === 0}
                  />
                  <textarea
                    className="min-h-[72px] w-full rounded-md border bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    value={saveNotes}
                    onChange={(e) => setSaveNotes(e.target.value)}
                    placeholder="Notas o comentarios"
                    disabled={saveSources.length === 0}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleSaveLocation}
                    disabled={saveSources.length === 0}
                  >
                    Guardar ubicacion
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                {savedLocations.length === 0 ? (
                  <div className="text-xs text-muted-foreground">No hay ubicaciones guardadas.</div>
                ) : (
                  savedLocations.map((item) => {
                    const lines = buildAddressLines(item.address ?? null);
                    return (
                      <div key={item.id} className="rounded-md border p-2 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="space-y-1">
                            <div className="text-sm font-semibold">{item.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {item.display_name ??
                                `${item.coords.lat.toFixed(6)}, ${item.coords.lon.toFixed(6)}`}
                            </div>
                            {lines.length > 0 && (
                              <div className="space-y-1 text-xs text-muted-foreground">
                                {lines.map((line) => (
                                  <div key={`${item.id}-${line}`}>{line}</div>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="flex flex-col gap-2">
                            <Button size="sm" onClick={() => handleGoToSaved(item)}>
                              Ver
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleDeleteSaved(item.id)}
                            >
                              Borrar
                            </Button>
                          </div>
                        </div>
                        <textarea
                          className="min-h-[64px] w-full rounded-md border bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                          value={item.notes ?? ""}
                          onChange={(e) => handleSavedNote(item.id, e.target.value)}
                          placeholder="Notas o comentarios"
                        />
                      </div>
                    );
                  })
                )}
              </div>
            </Card>

            {mode === "analyze" && loading && (
              <Card className="p-3 space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
              </Card>
            )}

            {mode === "analyze" && error && (
              <Alert className="p-3">
                <div className="text-sm">
                  <span className="font-semibold">Error:</span> {error}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Si una API externa falla, el backend aplica fallback y lo declara en Limitaciones.
                </div>
              </Alert>
            )}

            {mode === "analyze" && data && <ReportView data={data} />}

            {mode === "historic" && historyLoading && (
              <Card className="p-3 space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
              </Card>
            )}

            {mode === "historic" && historyError && (
              <Alert className="p-3">
                <div className="text-sm">
                  <span className="font-semibold">Error:</span> {historyError}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Si una API externa falla, el backend lo declara en Limitaciones.
                </div>
              </Alert>
            )}

            {mode === "historic" && historyData && <HistoryView data={historyData} />}

            {mode === "compare" && compareLoading && (
              <Card className="p-3 space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
              </Card>
            )}

            {mode === "compare" && compareError && (
              <Alert className="p-3">
                <div className="text-sm">
                  <span className="font-semibold">Error:</span> {compareError}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Verifica que haya dos ciudades seleccionadas.
                </div>
              </Alert>
            )}

            {mode === "compare" && compareData && <CompareView data={compareData} />}
          </div>
        </div>

        <div className="h-full">
          <MapView
            coords={mode === "compare" ? null : coords}
            mapStyle={mapStyle}
            showFloodLayer={showFloodLayer}
            locationName={location?.display_name ?? null}
            locationLines={addressLines}
            panRequestId={panRequestId}
            panZoom={panZoom}
            comparePoints={mode === "compare" ? comparePoints : undefined}
            onPick={(p) => {
              void handlePick(p);
            }}
            onAnalyze={(p) => {
              if (mode === "historic") {
                analyzeHistory({ lat: p.lat, lon: p.lon });
              } else {
                analyze({ lat: p.lat, lon: p.lon });
              }
            }}
            analyzeLabel={mode === "historic" ? "Historico aqui" : "Analizar aqui"}
            analyzeTooltip={mode === "historic" ? "Genera informe historico" : "Genera informe"}
          />
        </div>
      </div>
    </TooltipProvider>
  );
}
