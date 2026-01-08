import "./globals.css";
import { Toaster } from "sonner";

export const metadata = {
  title: "GeoAI Assistant",
  description: "Asistente geoespacial con IA (Next + Leaflet + Tools)"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-background text-foreground">
        {children}
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
