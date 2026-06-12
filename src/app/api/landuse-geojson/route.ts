import { NextRequest, NextResponse } from "next/server";
import {
  fetchLandUseGeoJson,
  isReinfolibGeoConfigured,
} from "@/lib/external/reinfolibGeo";

// GET /api/landuse-geojson?lat=&lon=&z=
// 用途地域のGeoJSON（地図オーバーレイ用）。要 REINFOLIB_API_KEY。
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const lat = Number(sp.get("lat"));
  const lon = Number(sp.get("lon"));
  const z = Number(sp.get("z") || 15);
  if (!isFinite(lat) || !isFinite(lon)) {
    return NextResponse.json({ error: "lat/lon が必要です" }, { status: 400 });
  }
  if (!isReinfolibGeoConfigured()) {
    return NextResponse.json(
      { configured: false, error: "用途地域オーバーレイには不動産情報ライブラリAPIキーが必要です" },
      { status: 503 }
    );
  }
  const gj = await fetchLandUseGeoJson(lat, lon, z);
  if (!gj) {
    return NextResponse.json({ configured: true, type: "FeatureCollection", features: [] });
  }
  return NextResponse.json({ configured: true, ...gj });
}
