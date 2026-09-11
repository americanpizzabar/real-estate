import { NextRequest, NextResponse } from "next/server";
import {
  fetchRecentTransactions,
  isReinfolibConfigured,
  type TransactionRecord,
} from "@/lib/external/reinfolib";
import { analyzeMarket } from "@/lib/external/marketAnalysis";
import { geocodeGSI, reverseGeocodeMuni } from "@/lib/external/geocode";

// =============================================================
// GET /api/market
//   ?address=…           … 住所から市区町村を自動特定（推奨）
//   ?lat=…&lon=…         … 座標指定（enrichment済みなら高速）
//   ?area=13&city=13102  … 手動指定フォールバック
//
// 不動産情報ライブラリの取引価格情報を「市区町村レベル・直近6四半期」
// で取得し、取引種別（土地のみ/土地建物/区分）に分類して統計を返す。
// レスポンスには出典・対象期間・市区町村など計算根拠を必ず含める。
// APIキー未設定時は明確に demo と表示する合成データ。
// =============================================================

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const address = sp.get("address") || "";
  let lat = sp.get("lat") ? Number(sp.get("lat")) : null;
  let lon = sp.get("lon") ? Number(sp.get("lon")) : null;
  let area = sp.get("area") || "";
  let city = sp.get("city") || "";

  const provenance: Record<string, unknown> = {};

  // --- 1) 住所/座標 → 市区町村コード（国土地理院・キー不要） ---
  if (!city) {
    try {
      if ((lat == null || lon == null) && address) {
        const g = await geocodeGSI(address);
        if (g) {
          lat = g.lat;
          lon = g.lon;
          provenance.geocoded = g.normalizedAddress;
        }
      }
      if (lat != null && lon != null) {
        const muni = await reverseGeocodeMuni(lat, lon);
        if (muni) {
          city = muni.muniCd;
          area = muni.prefCd;
          provenance.muniCd = muni.muniCd;
          provenance.muniHint = muni.lv01Nm;
        }
      }
    } catch {
      // 自動特定失敗 → area/city が無ければ後段でエラー or デモ
    }
  }
  if (!area && city) area = city.slice(0, 2);

  // --- 2) 取引事例の取得 ---
  let records: TransactionRecord[] = [];
  let periods: string[] = [];
  let source: "reinfolib" | "demo" = "demo";
  let fetchError: string | null = null;

  if (isReinfolibConfigured() && area) {
    try {
      const r = await fetchRecentTransactions(area, city || undefined);
      records = r.records;
      periods = r.periods;
      if (records.length > 0) source = "reinfolib";
      else if (r.allFailed)
        fetchError = `APIエラー（キー・接続を確認）: ${r.lastError ?? "全四半期で取得失敗"}`;
      else fetchError = "該当期間に事例が0件（市区町村を確認）";
    } catch (e: any) {
      fetchError = String(e?.message ?? e).slice(0, 120);
    }
  } else if (!isReinfolibConfigured()) {
    fetchError = "REINFOLIB_API_KEY 未設定";
  } else {
    fetchError = "市区町村を特定できませんでした（住所を確認）";
  }

  if (source === "demo") {
    records = syntheticRecords(area || "13");
    periods = ["デモ"];
  }

  // --- 3) 分類・統計 ---
  const analysis = analyzeMarket(records);

  return NextResponse.json({
    source,
    configured: isReinfolibConfigured(),
    fetchError,
    // 計算根拠（UIにそのまま表示する）
    scope: {
      municipality: analysis.municipality ?? (source === "demo" ? "デモデータ" : null),
      muniCd: city || null,
      prefCode: area || null,
      periods,
      api: source === "reinfolib" ? "国交省 不動産情報ライブラリ 取引価格情報(XIT001)" : "合成デモデータ",
      ...provenance,
    },
    analysis,
  });
}

/** デモ用の合成事例（出典が demo と明示される）。 */
function syntheticRecords(area: string): TransactionRecord[] {
  const baseByArea: Record<string, number> = {
    "13": 850_000, "14": 480_000, "27": 420_000, "23": 350_000, "40": 300_000,
  };
  const base = baseByArea[area] ?? 350_000;
  const out: TransactionRecord[] = [];
  const seed = (parseInt(area, 10) || 13) * 7;
  const types = ["宅地(土地)", "宅地(土地と建物)", "中古マンション等"];
  for (let i = 0; i < 30; i++) {
    const r = Math.abs((Math.sin(seed + i * 12.9898) * 43758.5453) % 1);
    const type = types[i % 3];
    // 種別ごとの単価感を変える（土地<一体<区分のイメージで現実に寄せる）
    const mult = type === "宅地(土地)" ? 1 : type === "宅地(土地と建物)" ? 1.4 : 1.8;
    const unit = Math.round(base * mult * (0.7 + r * 0.6));
    const a = Math.round(40 + Math.abs((r * 7) % 1) * 160);
    out.push({
      price: unit * a,
      unitPrice: type === "宅地(土地)" ? unit : undefined,
      area: a,
      type,
      period: "デモ",
      use: "住宅地",
      structure: i % 2 ? "RC" : "木造",
      municipality: "デモデータ（実在の相場ではありません）",
    });
  }
  return out;
}
