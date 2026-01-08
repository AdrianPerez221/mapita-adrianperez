"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import dynamic from "next/dynamic";
import ReportView from "@/components/report-view";

// shadcn/ui components (generados por CLI)
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

import type { AnalyzeResponse } from "@/lib/types";

const MapView = dynamic(() => import("@/components/map-view"), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full flex items-center justify-center text-sm text-muted-foreground">
      Cargando mapa…
    </div>
  ),
});

export default function GeoAssistant() {
  const [address, setAddress] = useState("");
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<AnalyzeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canAnalyze = useMemo(() => Boolean(address.trim()) || Boolean(coords), [address, coords]);

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

      setData(json);
      if (json.coords) {
        setCoords({ lat: json.coords.lat, lon: json.coords.lon });
      }
      toast.success("Informe generado");
    } catch (e: any) {
      const msg = e?.message ?? "Falló el análisis";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <TooltipProvider>
      <div className="h-full w-full grid grid-cols-1 lg:grid-cols-[420px_1fr]">
        {/* Panel lateral */}
        <div className="h-full border-r bg-white/60 backdrop-blur supports-[backdrop-filter]:bg-white/40 p-4 overflow-y-auto">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h1 className="text-xl font-semibold">GeoAI Assistant</h1>
              <p className="text-sm text-muted-foreground">
                Dirección o click en el mapa → tools reales → informe con fuentes.
              </p>
            </div>
            <Badge variant="secondary">Clase</Badge>
          </div>

          <div className="mt-4 space-y-3">
            <Card className="p-3">
              <div className="flex items-center gap-2">
                <Input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Escribe una dirección (ej: Calle X, Valencia)"
                />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      onClick={() => analyze({ address })}
                      disabled={loading || !address.trim()}
                    >
                      Buscar
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Geocoding real con Nominatim</TooltipContent>
                </Tooltip>
              </div>

              <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {coords ? (
                    <>
                      Coordenadas:{" "}
                      <span className="font-medium text-foreground">
                        {coords.lat.toFixed(6)}, {coords.lon.toFixed(6)}
                      </span>
                    </>
                  ) : (
                    "Tip: también puedes hacer click en el mapa"
                  )}
                </span>

                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setAddress("");
                    setCoords(null);
                    setData(null);
                    setError(null);
                    toast("Listo: estado reiniciado");
                  }}
                >
                  Reset
                </Button>
              </div>
            </Card>

            <div className="flex gap-2">
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
            </div>

            {loading && (
              <Card className="p-3 space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
              </Card>
            )}

            {error && (
              <Alert className="p-3">
                <div className="text-sm">
                  <span className="font-semibold">Error:</span> {error}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Si una API externa cae, el backend aplica fallback y lo declara en “Limitaciones”.
                </div>
              </Alert>
            )}

            {data && <ReportView data={data} />}
          </div>
        </div>

        {/* Mapa */}
        <div className="h-full">
          <MapView
            coords={coords}
            onPick={(p) => {
              setCoords(p);
              toast.message("Punto seleccionado", {
                description: `${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}`
              });
            }}
            onAnalyze={(p) => analyze({ lat: p.lat, lon: p.lon })}
          />
        </div>
      </div>
    </TooltipProvider>
  );
}
