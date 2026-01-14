"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import "leaflet/dist/leaflet.css";
import "leaflet-defaulticon-compatibility/dist/leaflet-defaulticon-compatibility.css";

import type { LatLngTuple } from "leaflet";
import { MapContainer, TileLayer, Marker, Popup, WMSTileLayer, useMap, useMapEvents } from "react-leaflet";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type MapStyle = "standard" | "satellite" | "pollution";
type ComparePoint = {
  id: "A" | "B";
  coords: { lat: number; lon: number };
  locationName?: string | null;
  locationLines?: string[];
};
export default function MapView(props: {
  coords: { lat: number; lon: number } | null;
  mapStyle: MapStyle;
  showFloodLayer: boolean;
  locationName?: string | null;
  locationLines?: string[];
  panRequestId: number;
  comparePoints?: ComparePoint[];
  onPick: (p: { lat: number; lon: number }) => void;
  onAnalyze: (p: { lat: number; lon: number }) => void;
  analyzeLabel?: string;
  analyzeTooltip?: string;
  panZoom?: number | null;
}) {
  useEffect(() => {
    import("leaflet-defaulticon-compatibility");
  }, []);

  const {
    coords,
    mapStyle,
    showFloodLayer,
    locationName,
    locationLines,
    panRequestId,
    panZoom,
    comparePoints,
    onPick,
    onAnalyze,
    analyzeLabel,
    analyzeTooltip,
  } = props;
  const [floodLoading, setFloodLoading] = useState(false);
  const initialCenter = useMemo<LatLngTuple>(() => [39.4699, -0.3763], []);
  const initialZoom = 12;
  const minZoom = 3;
  const maxZoom = 18;
  const gibsDate = useMemo(() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 2);
    return d.toISOString().slice(0, 10);
  }, []);
  const gibsUrl = useMemo(
    () => `https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi?time=${gibsDate}`,
    [gibsDate]
  );
  const floodEventHandlers = useMemo(
    () => ({
      loading: () => setFloodLoading(true),
      load: () => setFloodLoading(false),
      tileerror: () => setFloodLoading(false),
    }),
    []
  );

  useEffect(() => {
    if (showFloodLayer) setFloodLoading(true);
    else setFloodLoading(false);
  }, [showFloodLayer]);

  function ClickHandler({ onPick }: { onPick: (p: { lat: number; lon: number }) => void }) {
    useMapEvents({
      click(e) {
        onPick({ lat: e.latlng.lat, lon: e.latlng.lng });
      },
    });
    return null;
  }

  function FocusOnCoords({
    coords,
    panRequestId,
    panZoom,
  }: {
    coords: { lat: number; lon: number } | null;
    panRequestId: number;
    panZoom?: number | null;
  }) {
    const map = useMap();
    const lastPan = useRef<number>(panRequestId);

    useEffect(() => {
      if (!coords) return;
      if (panRequestId === lastPan.current) return;
      lastPan.current = panRequestId;
      const target: LatLngTuple = [coords.lat, coords.lon];
      if (typeof panZoom === "number") {
        map.setView(target, panZoom, { animate: true });
        return;
      }
      map.panTo(target, { animate: true });
    }, [coords?.lat, coords?.lon, map, panRequestId, panZoom]);

    return null;
  }

  return (
    <div className="relative h-full w-full">
      <MapContainer
        center={initialCenter}
        zoom={initialZoom}
        minZoom={minZoom}
        maxZoom={maxZoom}
        className="h-full w-full"
      >
      {mapStyle === "satellite" ? (
        <TileLayer
          attribution="&copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community"
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        />
      ) : (
        <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      )}

      {mapStyle === "satellite" && (
        <TileLayer
          attribution="&copy; Esri"
          url="https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
        />
      )}

      {mapStyle === "pollution" && (
        <WMSTileLayer
          url={gibsUrl}
          layers="MODIS_Terra_Aerosol"
          format="image/png"
          transparent
          opacity={0.6}
          attribution="NASA GIBS"
        />
      )}

        {showFloodLayer && (
          <WMSTileLayer
            url="https://european-flood.emergency.copernicus.eu/api/wms/"
            layers="mapserver:Europe_combined_flood_scenarios"
            format="image/png"
            transparent
            opacity={0.45}
            attribution="Copernicus EFAS"
            eventHandlers={floodEventHandlers}
          />
        )}

      <ClickHandler onPick={onPick} />
      <FocusOnCoords coords={coords} panRequestId={panRequestId} panZoom={panZoom} />

        {comparePoints && comparePoints.length > 0 ? (
          comparePoints.map((point) => (
            <Marker key={point.id} position={[point.coords.lat, point.coords.lon]}>
              <Popup>
                <div className="space-y-2">
                  <div className="text-sm font-medium">Ciudad {point.id}</div>
                  <div className="text-xs">
                    {point.coords.lat.toFixed(6)}, {point.coords.lon.toFixed(6)}
                  </div>
                  {point.locationName && (
                    <div className="text-xs text-muted-foreground">
                      {point.locationName}
                    </div>
                  )}
                  {point.locationLines && point.locationLines.length > 0 && (
                    <div className="space-y-1 text-xs text-muted-foreground">
                      {point.locationLines.map((line) => (
                        <div key={line}>{line}</div>
                      ))}
                    </div>
                  )}
                </div>
              </Popup>
            </Marker>
          ))
        ) : coords ? (
          <Marker position={[coords.lat, coords.lon]}>
            <Popup>
              <div className="space-y-2">
                <div className="text-sm font-medium">Punto seleccionado</div>
                <div className="text-xs">
                  {coords.lat.toFixed(6)}, {coords.lon.toFixed(6)}
                </div>
                {locationName && (
                  <div className="text-xs text-muted-foreground">
                    {locationName}
                  </div>
                )}
                {locationLines && locationLines.length > 0 && (
                  <div className="space-y-1 text-xs text-muted-foreground">
                    {locationLines.map((line) => (
                      <div key={line}>{line}</div>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <Tooltip>
                  <TooltipTrigger asChild>
                    <Button size="sm" onClick={() => onAnalyze(coords)}>
                      {analyzeLabel ?? "Analizar aqui"}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top" align="center" sideOffset={6}>
                    {analyzeTooltip ?? "Genera informe"}
                  </TooltipContent>
                </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          if (!navigator?.clipboard?.writeText) return;
                          void navigator.clipboard.writeText(`${coords.lat},${coords.lon}`).catch(() => {});
                        }}
                      >
                        Copiar coords
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top" align="center" sideOffset={6}>
                      Copia lat/lon
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
            </Popup>
          </Marker>
        ) : null}
      </MapContainer>

      {showFloodLayer && floodLoading && (
        <div className="absolute right-3 top-3 z-[800]">
          <div className="rounded-md bg-foreground text-background px-3 py-2 text-xs shadow-sm">
            <div className="flex items-center gap-2">
              <span className="font-medium">Cargando inundacion</span>
              <span className="h-1 w-16 overflow-hidden rounded-full bg-white/30">
                <span className="block h-full w-1/2 rounded-full bg-white/80 animate-pulse" />
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
