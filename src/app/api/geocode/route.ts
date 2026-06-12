import { NextRequest, NextResponse } from "next/server";
import { geocodeGSI } from "@/lib/external/geocode";

// GET /api/geocode?q=住所  → 国土地理院ジオコーディング（キー不要）
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q");
  if (!q) return NextResponse.json({ error: "q is required" }, { status: 400 });
  try {
    const r = await geocodeGSI(q);
    if (!r) return NextResponse.json({ error: "住所が特定できませんでした" }, { status: 404 });
    return NextResponse.json(r);
  } catch (e: any) {
    return NextResponse.json({ error: `geocode失敗: ${e?.message}` }, { status: 502 });
  }
}
