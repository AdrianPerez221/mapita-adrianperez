import { NextResponse } from "next/server";
import { z } from "zod";
import { capasUrbanismo } from "@/lib/tools/capasUrbanismo";

const Body = z.object({
  lat: z.number(),
  lon: z.number(),
  radius_m: z.number().nullable().optional()
});

export async function POST(req: Request) {
  try {
    const body = Body.parse(await req.json());
    const r = await capasUrbanismo(body.lat, body.lon, body.radius_m ?? 1200);
    return NextResponse.json({ ok: true, data: r });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Error urban" }, { status: 400 });
  }
}
