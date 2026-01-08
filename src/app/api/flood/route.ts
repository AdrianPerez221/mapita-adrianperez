import { NextResponse } from "next/server";
import { z } from "zod";
import { riesgoInundacion } from "@/lib/tools/riesgoInundacion";

const Body = z.object({
  lat: z.number(),
  lon: z.number()
});

export async function POST(req: Request) {
  try {
    const body = Body.parse(await req.json());
    const r = await riesgoInundacion(body.lat, body.lon);
    return NextResponse.json({ ok: true, data: r });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Error flood" }, { status: 400 });
  }
}
