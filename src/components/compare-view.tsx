"use client";

import ReactMarkdown from "react-markdown";
import type { CompareResponse } from "@/lib/types";

import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

export default function CompareView({ data }: { data: CompareResponse }) {
  return (
    <Card className="p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">Comparacion</div>
          <div className="text-xs text-muted-foreground">Informe VS entre dos ciudades</div>
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
            <AccordionItem value="city-a">
              <AccordionTrigger>Ciudad A (datos)</AccordionTrigger>
              <AccordionContent>
                <pre className="text-xs whitespace-pre-wrap">
                  {JSON.stringify(data.cityA ?? null, null, 2)}
                </pre>
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="city-b">
              <AccordionTrigger>Ciudad B (datos)</AccordionTrigger>
              <AccordionContent>
                <pre className="text-xs whitespace-pre-wrap">
                  {JSON.stringify(data.cityB ?? null, null, 2)}
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
              <li key={idx}>- {l}</li>
            ))}
          </ul>
        </TabsContent>
      </Tabs>
    </Card>
  );
}
