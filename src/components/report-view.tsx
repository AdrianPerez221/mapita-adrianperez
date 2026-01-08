"use client";

import ReactMarkdown from "react-markdown";
import type { AnalyzeResponse } from "@/lib/types";

// shadcn/ui
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

export default function ReportView({ data }: { data: AnalyzeResponse }) {
  return (
    <Card className="p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">Resultado</div>
          <div className="text-xs text-muted-foreground">
            {data.coords?.display_name ?? "Ubicación"}
          </div>
        </div>
        <Badge variant="secondary">con tools</Badge>
      </div>

      <Separator className="my-3" />

      <Tabs defaultValue="report">
        <TabsList className="grid grid-cols-4">
          <TabsTrigger value="report">Informe</TabsTrigger>
          <TabsTrigger value="data">Datos</TabsTrigger>
          <TabsTrigger value="sources">Fuentes</TabsTrigger>
          <TabsTrigger value="limits">Limitaciones</TabsTrigger>
        </TabsList>

        <TabsContent value="report" className="mt-3">
          <div className="prose prose-sm max-w-none">
            <ReactMarkdown>{data.report_markdown ?? "No hay informe."}</ReactMarkdown>
          </div>
        </TabsContent>

        <TabsContent value="data" className="mt-3">
          <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="urban">
              <AccordionTrigger>capasUrbanismo (resumen)</AccordionTrigger>
              <AccordionContent>
                <pre className="text-xs whitespace-pre-wrap">
                  {JSON.stringify(data.urban, null, 2)}
                </pre>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="flood">
              <AccordionTrigger>riesgoInundacion (resumen)</AccordionTrigger>
              <AccordionContent>
                <pre className="text-xs whitespace-pre-wrap">
                  {JSON.stringify(data.flood, null, 2)}
                </pre>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="raw">
              <AccordionTrigger>raw (debug)</AccordionTrigger>
              <AccordionContent>
                <pre className="text-xs whitespace-pre-wrap">
                  {JSON.stringify(data.debug ?? null, null, 2)}
                </pre>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </TabsContent>

        <TabsContent value="sources" className="mt-3">
          <ul className="text-xs space-y-2">
            {data.sources?.map((s) => (
              <li key={s.name}>
                <span className="font-semibold">{s.name}</span>
                <div className="text-muted-foreground break-all">{s.url}</div>
              </li>
            ))}
          </ul>
        </TabsContent>

        <TabsContent value="limits" className="mt-3">
          <ul className="text-xs space-y-2">
            {(data.limitations ?? []).map((l, idx) => (
              <li key={idx}>• {l}</li>
            ))}
          </ul>
        </TabsContent>
      </Tabs>
    </Card>
  );
}
