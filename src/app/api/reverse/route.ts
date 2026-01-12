import { NextResponse } from "next/server";
import { z } from "zod";
import { reverseGeocode } from "@/lib/tools/reverseGeocode";

const Body = z.object({
  lat: z.number(),
  lon: z.number(),
  zoom: z.number().int().min(3).max(20).optional(),
});

export async function POST(req: Request) {
  try {
    const body = Body.parse(await req.json());
    const out = await reverseGeocode(body.lat, body.lon, body.zoom ?? 18);
    return NextResponse.json({ ok: out.ok === false ? false : true, ...out });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Error reverse" }, { status: 400 });
  }
}
