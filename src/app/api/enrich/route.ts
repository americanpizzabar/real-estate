import { NextRequest, NextResponse } from "next/server";
import { geocodeGSI } from "@/lib/external/geocode";
import { assessHazards } from "@/lib/external/hazard";
import {
  fetchLandUse,
  fetchNearestLandPrice,
  isReinfolibGeoConfigured,
} from "@/lib/external/reinfolibGeo";
import type { Enrichment, EnrichCheck } from "@/lib/external/enrichment";

// =============================================================
// POST /api/enrich
// body: { address, lat?, lon?, maisoku?: { rosenkaPerSqm?, koujiPerSqm?,
//         zoningUse?, buildingCoveragePct?, floorAreaRatioPct? } }
// 住所→緯度経度→ハザード/用途地域/地価を自動取得し、
// マイソク記載との突合せ（食い違いアラート）まで行う。
// =============================================================

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const address: string = body.address || "";
  let lat: number | undefined = body.lat;
  let lon: number | undefined = body.lon;
  let normalizedAddress = address;

  // 1) ジオコーディング（座標未指定なら）
  if (lat == null || lon == null) {
    if (!address) {
      return NextResponse.json({ error: "address または lat/lon が必要です" }, { status: 400 });
    }
    try {
      const g = await geocodeGSI(address);
      if (!g) return NextResponse.json({ error: "住所を特定できませんでした" }, { status: 404 });
      lat = g.lat;
      lon = g.lon;
      normalizedAddress = g.normalizedAddress;
    } catch (e: any) {
      return NextResponse.json({ error: `ジオコーディング失敗: ${e?.message}` }, { status: 502 });
    }
  }

  // 2) 並行取得: ハザード / 用途地域 / 地価
  const [hazard, landUseRaw, landPriceRaw] = await Promise.all([
    assessHazards(lat!, lon!).catch(() => null),
    isReinfolibGeoConfigured() ? fetchLandUse(lat!, lon!).catch(() => null) : Promise.resolve(null),
    isReinfolibGeoConfigured() ? fetchNearestLandPrice(lat!, lon!).catch(() => null) : Promise.resolve(null),
  ]);

  const landUse = landUseRaw
    ? { ...landUseRaw, source: "reinfolib" as const }
    : isReinfolibGeoConfigured()
      ? null
      : { source: "none" as const };
  const landPrice = landPriceRaw
    ? { ...landPriceRaw, source: "reinfolib" as const }
    : isReinfolibGeoConfigured()
      ? null
      : { source: "none" as const };

  // 3) マイソク記載との突合せ
  const checks: EnrichCheck[] = [];
  const m = body.maisoku ?? {};
  if (landUseRaw?.buildingCoveragePct != null && m.buildingCoveragePct != null) {
    pushCompare(checks, "建蔽率", m.buildingCoveragePct + "%", landUseRaw.buildingCoveragePct + "%",
      Math.abs(landUseRaw.buildingCoveragePct - m.buildingCoveragePct) < 1);
  }
  if (landUseRaw?.floorAreaRatioPct != null && m.floorAreaRatioPct != null) {
    pushCompare(checks, "容積率", m.floorAreaRatioPct + "%", landUseRaw.floorAreaRatioPct + "%",
      Math.abs(landUseRaw.floorAreaRatioPct - m.floorAreaRatioPct) < 1);
  }
  if (landUseRaw?.zoningUse && m.zoningUse) {
    pushCompare(checks, "用途地域", m.zoningUse, landUseRaw.zoningUse,
      landUseRaw.zoningUse.includes(m.zoningUse) || m.zoningUse.includes(landUseRaw.zoningUse));
  }
  if (landPriceRaw?.koujiPerSqm && m.koujiPerSqm) {
    const diff = Math.abs(landPriceRaw.koujiPerSqm - m.koujiPerSqm) / m.koujiPerSqm;
    pushCompare(checks, "公示地価", `${m.koujiPerSqm.toLocaleString()}円/㎡`,
      `${landPriceRaw.koujiPerSqm.toLocaleString()}円/㎡`, diff < 0.1);
  }

  const result: Enrichment = {
    lat: lat!,
    lon: lon!,
    normalizedAddress,
    hazard,
    landUse,
    landPrice,
    checks,
  };
  return NextResponse.json(result);
}

function pushCompare(
  checks: EnrichCheck[],
  field: string,
  maisokuValue: string,
  officialValue: string,
  ok: boolean
) {
  checks.push({
    field,
    maisokuValue,
    officialValue,
    status: ok ? "match" : "mismatch",
    message: ok
      ? `${field}はマイソク記載と公的データが一致。`
      : `${field}に食い違い。マイソク「${maisokuValue}」／公的「${officialValue}」。要確認。`,
  });
}
