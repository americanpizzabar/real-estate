import { NextResponse } from "next/server";
import { geocodeGSI, reverseGeocodeMuni } from "@/lib/external/geocode";
import { fetchRecentTransactions, isReinfolibConfigured } from "@/lib/external/reinfolib";
import { fetchNearestLandPrice, fetchLandUse } from "@/lib/external/reinfolibGeo";
import { assessHazards } from "@/lib/external/hazard";
import { isGeminiConfigured } from "@/lib/external/gemini";
import { tursoConfigured } from "@/lib/db/turso";

// =============================================================
// GET /api/selftest
// 各外部データ源に既知の入力を投げ、実データの到達性と妥当性を検証。
// デプロイ環境（キー・ネットワークあり）で実行して精度を実地確認する。
// =============================================================

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface Check {
  name: string;
  ok: boolean;
  detail: string;
  keyNeeded?: boolean;
  configured?: boolean;
}

export async function GET() {
  const checks: Check[] = [];
  // 既知の基準点: 東京都庁（新宿区西新宿2-8-1）≈ (35.6896, 139.6917)
  const TOKYO_ADDR = "東京都新宿区西新宿2-8-1";
  const EXPECT_LAT = 35.6896;
  const EXPECT_LON = 139.6917;

  // 1) ジオコーディング（キー不要）
  let lat = EXPECT_LAT, lon = EXPECT_LON, geocodeOk = false;
  try {
    const g = await geocodeGSI(TOKYO_ADDR);
    if (g) {
      lat = g.lat; lon = g.lon;
      const dLat = Math.abs(g.lat - EXPECT_LAT);
      const dLon = Math.abs(g.lon - EXPECT_LON);
      geocodeOk = dLat < 0.05 && dLon < 0.05;
      checks.push({
        name: "ジオコーディング(GSI)", ok: geocodeOk,
        detail: `${TOKYO_ADDR} → (${g.lat.toFixed(4)}, ${g.lon.toFixed(4)})　期待(35.69,139.69)との差 ${(dLat).toFixed(4)}/${(dLon).toFixed(4)}`,
      });
    } else {
      checks.push({ name: "ジオコーディング(GSI)", ok: false, detail: "住所を特定できませんでした" });
    }
  } catch (e: any) {
    checks.push({ name: "ジオコーディング(GSI)", ok: false, detail: `失敗: ${e?.message ?? e}` });
  }

  // 2) 逆ジオコーディング → 市区町村コード
  try {
    const muni = await reverseGeocodeMuni(lat, lon);
    const ok = !!muni && muni.muniCd.startsWith("131"); // 東京23区は131xx
    checks.push({
      name: "逆ジオコーディング(GSI)", ok,
      detail: muni ? `muniCd=${muni.muniCd}（${muni.lv01Nm ?? ""}）期待:131xx（新宿区=13104）` : "取得不可",
    });
  } catch (e: any) {
    checks.push({ name: "逆ジオコーディング(GSI)", ok: false, detail: `失敗: ${e?.message ?? e}` });
  }

  // 3) ハザード（キー不要）
  try {
    const h = await assessHazards(lat, lon);
    checks.push({ name: "ハザード判定(GSI)", ok: true, detail: h.summary });
  } catch (e: any) {
    checks.push({ name: "ハザード判定(GSI)", ok: false, detail: `失敗: ${e?.message ?? e}` });
  }

  const reinfolib = isReinfolibConfigured();

  // 4) 取引価格情報（要キー）
  if (reinfolib) {
    try {
      const r = await fetchRecentTransactions("13", "13104"); // 新宿区
      const ok = r.records.length > 0;
      const unit = r.records.find((x) => x.unitPrice || (x.price && x.area))?.unitPrice;
      checks.push({
        name: "取引価格情報(不動産情報ライブラリ)", ok,
        detail: ok ? `新宿区で${r.records.length}件取得（期間: ${r.periods.join(",")}）${unit ? ` 例:${Math.round(unit).toLocaleString()}円/㎡` : ""}` : `0件（${r.lastError ?? "要確認"}）`,
        keyNeeded: true, configured: true,
      });
    } catch (e: any) {
      checks.push({ name: "取引価格情報(不動産情報ライブラリ)", ok: false, detail: `失敗: ${e?.message ?? e}`, keyNeeded: true, configured: true });
    }

    // 5) 公示地価（要キー）: 都心は数十万〜数百万円/㎡が妥当
    try {
      const lp = await fetchNearestLandPrice(lat, lon);
      const ok = !!lp && lp.koujiPerSqm! > 100_000 && lp.koujiPerSqm! < 30_000_000;
      checks.push({
        name: "公示地価(不動産情報ライブラリ)", ok,
        detail: lp ? `${Math.round(lp.koujiPerSqm!).toLocaleString()}円/㎡（約${lp.distanceM}m先）都心妥当域=10万〜3000万/㎡` : "近傍に公示点なし",
        keyNeeded: true, configured: true,
      });
    } catch (e: any) {
      checks.push({ name: "公示地価(不動産情報ライブラリ)", ok: false, detail: `失敗: ${e?.message ?? e}`, keyNeeded: true, configured: true });
    }

    // 6) 用途地域（要キー）
    try {
      const lu = await fetchLandUse(lat, lon);
      checks.push({
        name: "用途地域(不動産情報ライブラリ)", ok: !!lu?.zoningUse,
        detail: lu?.zoningUse ? `${lu.zoningUse}（建蔽${lu.buildingCoveragePct ?? "—"}%/容積${lu.floorAreaRatioPct ?? "—"}%）` : "取得不可（エンドポイント/座標を確認）",
        keyNeeded: true, configured: true,
      });
    } catch (e: any) {
      checks.push({ name: "用途地域(不動産情報ライブラリ)", ok: false, detail: `失敗: ${e?.message ?? e}`, keyNeeded: true, configured: true });
    }
  } else {
    checks.push({ name: "不動産情報ライブラリAPI", ok: false, detail: "REINFOLIB_API_KEY 未設定（取引事例・公示地価・用途地域が使えません）", keyNeeded: true, configured: false });
  }

  const env = {
    REINFOLIB_API_KEY: reinfolib,
    GOOGLE_AI_API_KEY: isGeminiConfigured(),
    BROWSER_WS_ENDPOINT: !!process.env.BROWSER_WS_ENDPOINT,
    TURSO_DATABASE_URL: tursoConfigured(),
  };
  const passed = checks.filter((c) => c.ok).length;

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    summary: `${passed}/${checks.length} 検査パス`,
    env,
    checks,
  });
}
