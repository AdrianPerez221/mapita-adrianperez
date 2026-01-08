"use client";

import { useEffect } from "react";

import "leaflet/dist/leaflet.css";
import "leaflet-defaulticon-compatibility/dist/leaflet-defaulticon-compatibility.css";

import type { LatLngTuple } from "leaflet";
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from "react-leaflet";
import { Button } from "@/components/ui/button";

export default function MapView(props: {
  coords: { lat: number; lon: number } | null;
  onPick: (p: { lat: number; lon: number }) => void;
  onAnalyze: (p: { lat: number; lon: number }) => void;
}) {
  useEffect(() => {
    // ✅ solo en navegador
    import("leaflet-defaulticon-compatibility");
  }, []);

  const { coords, onPick, onAnalyze } = props;

  const defaultCenter: LatLngTuple = [39.4699, -0.3763];
  const center: LatLngTuple = coords ? [coords.lat, coords.lon] : defaultCenter;

  function ClickHandler({ onPick }: { onPick: (p: { lat: number; lon: number }) => void }) {
    useMapEvents({
      click(e) {
        onPick({ lat: e.latlng.lat, lon: e.latlng.lng });
      },
    });
    return null;
  }

  return (
    <MapContainer center={center} zoom={coords ? 14 : 12} className="h-full w-full">
      <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

      <ClickHandler onPick={onPick} />

      {coords && (
        <Marker position={[coords.lat, coords.lon]}>
          <Popup>
            <div className="space-y-2">
              <div className="text-sm font-medium">Punto seleccionado</div>
              <div className="text-xs">
                {coords.lat.toFixed(6)}, {coords.lon.toFixed(6)}
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => onAnalyze(coords)}>
                  Analizar aquí
                </Button>
                <Button size="sm" variant="secondary" onClick={() => navigator.clipboard.writeText(`${coords.lat},${coords.lon}`)}>
                  Copiar coords
                </Button>
              </div>
            </div>
          </Popup>
        </Marker>
      )}
    </MapContainer>
  );
}
