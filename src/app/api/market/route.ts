import { NextRequest, NextResponse } from "next/server";
import {
  fetchTransactions,
  isReinfolibConfigured,
  type TransactionRecord,
} from "@/lib/external/reinfolib";
import { analyzeMarket } from "@/lib/external/marketAnalysis";

// =============================================================
// GET /api/market?area=13&year=2024&quarter=2&targetArea=120&use=住宅地
// 不動産情報ライブラリAPIが設定済みなら実データ、未設定なら
// 合成（デモ）データを返す。source フィールドで区別できる。
// =============================================================

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const area = sp.get("area") || "13";
  const year = Number(sp.get("year") || new Date().getFullYear() - 1);
  const quarter = Number(sp.get("quarter") || 2);
  const targetArea = Number(sp.get("targetArea") || 100);
  const use = sp.get("use") || undefined;
  const city = sp.get("city") || undefined;

  let records: TransactionRecord[] = [];
  let source: "reinfolib" | "demo" = "demo";

  if (isReinfolibConfigured()) {
    try {
      records = await fetchTransactions(area, year, quarter, city);
      source = "reinfolib";
    } catch (e) {
      // 失敗時はデモにフォールバック
      records = syntheticRecords(area, targetArea);
      source = "demo";
    }
  } else {
    records = syntheticRecords(area, targetArea);
  }

  const stats = analyzeMarket(records, targetArea, use);
  return NextResponse.json({
    source,
    configured: isReinfolibConfigured(),
    stats,
    sampleCount: records.length,
    samples: records.slice(0, 12),
  });
}

/**
 * デモ用の合成取引事例。エリアコードで単価水準を変え、
 * 正規分布っぽいばらつきを与える（実APIの体感に近づける）。
 */
function syntheticRecords(area: string, targetArea: number): TransactionRecord[] {
  // エリア別の基準単価（円/㎡）の目安
  const baseByArea: Record<string, number> = {
    "13": 850_000, // 東京
    "14": 480_000, // 神奈川
    "27": 420_000, // 大阪
    "23": 350_000, // 愛知
    "40": 300_000, // 福岡
  };
  const base = baseByArea[area] ?? 350_000;
  const out: TransactionRecord[] = [];
  const seed = (area.charCodeAt(0) || 13) * 7;
  for (let i = 0; i < 24; i++) {
    // 疑似乱数（決定的）でばらつき ±35%
    const r = (Math.sin(seed + i * 12.9898) * 43758.5453) % 1;
    const factor = 0.65 + Math.abs(r) * 0.7;
    const unit = Math.round(base * factor);
    const a = Math.round(targetArea * (0.7 + Math.abs((r * 3) % 1) * 0.8));
    out.push({
      price: unit * a,
      unitPrice: unit,
      area: a,
      station: "最寄駅",
      period: `${new Date().getFullYear() - 1}年第${(i % 4) + 1}四半期`,
      use: "住宅地",
      structure: i % 2 ? "RC" : "木造",
      municipality: "サンプル市区",
    });
  }
  return out;
}
