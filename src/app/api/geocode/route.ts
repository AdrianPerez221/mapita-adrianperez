import { NextResponse } from "next/server";
import { z } from "zod";
import { buscarCoordenadas } from "@/lib/tools/buscarCoordenadas";

const Body = z.object({
  address: z.string().min(3),
  country_code: z.string().nullable().optional(),
  limit: z.number().int().min(1).max(5).nullable().optional()
});

export async function POST(req: Request) {
  try {
    const body = Body.parse(await req.json());
    const r = await buscarCoordenadas(body.address, body.country_code ?? "es", body.limit ?? 1);
    return NextResponse.json({ ok: true, ...r });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Error geocode" }, { status: 400 });
  }
}
