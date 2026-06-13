import type { TransactionRecord } from "./reinfolib";

// =============================================================
// マーケットアプローチ — 実勢価格の集計と乖離率の算出
//
// 取引事例を「取引の種類」で分類して別々に集計する:
//  - land     宅地(土地)        … 土地のみの成約 → 円/㎡（土地値の実勢）
//  - landBldg 宅地(土地と建物)  … 一棟・戸建て等 → 円/㎡(土地面積按分)
//  - condo    中古マンション等  … 区分 → 円/㎡(専有面積)
// 種別を混ぜた単価中央値は意味を持たないため、必ず分類して扱い、
// どの分類を何件使ったかを呼び出し側（UI）に開示する。
// =============================================================

export type CompCategory = "land" | "landBldg" | "condo" | "other";

export interface CategoryStats {
  count: number;
  medianUnitPrice: number; // 円/㎡
  meanUnitPrice: number;
  minUnitPrice: number;
  maxUnitPrice: number;
  /** 代表事例（UI表示用、単価順の中央付近から数件） */
  samples: TransactionRecord[];
}

export interface MarketAnalysis {
  /** 分類別の統計 */
  land: CategoryStats | null;
  landBldg: CategoryStats | null;
  condo: CategoryStats | null;
  /** 全事例数（分類不能含む） */
  totalCount: number;
  /** 集計に使った市区町村名（事例レコードから取得） */
  municipality: string | null;
}

export function classify(r: TransactionRecord): CompCategory {
  const t = r.type ?? "";
  if (t.includes("中古マンション")) return "condo";
  if (t.includes("土地と建物")) return "landBldg";
  if (t.includes("宅地") || t.includes("土地")) return "land";
  return "other";
}

function unitPriceOf(r: TransactionRecord): number | null {
  if (r.unitPrice && r.unitPrice > 0) return r.unitPrice;
  if (r.price > 0 && r.area && r.area > 0) return r.price / r.area;
  return null;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function buildStats(records: TransactionRecord[]): CategoryStats | null {
  const withUp = records
    .map((r) => ({ r, up: unitPriceOf(r) }))
    .filter((x): x is { r: TransactionRecord; up: number } => x.up != null && isFinite(x.up) && x.up > 0);
  if (withUp.length === 0) return null;

  const ups = withUp.map((x) => x.up);
  const med = median(ups);
  // 中央値近傍の事例を代表サンプルに（外れ値でなく「相場らしい」事例を見せる）
  const sorted = [...withUp].sort((a, b) => Math.abs(a.up - med) - Math.abs(b.up - med));
  return {
    count: ups.length,
    medianUnitPrice: Math.round(med),
    meanUnitPrice: Math.round(ups.reduce((a, b) => a + b, 0) / ups.length),
    minUnitPrice: Math.round(Math.min(...ups)),
    maxUnitPrice: Math.round(Math.max(...ups)),
    samples: sorted.slice(0, 5).map((x) => x.r),
  };
}

/** 取引事例を分類して統計化する。 */
export function analyzeMarket(records: TransactionRecord[]): MarketAnalysis {
  const buckets: Record<CompCategory, TransactionRecord[]> = {
    land: [], landBldg: [], condo: [], other: [],
  };
  for (const r of records) buckets[classify(r)].push(r);

  const municipality =
    records.find((r) => r.municipality)?.municipality ?? null;

  return {
    land: buildStats(buckets.land),
    landBldg: buildStats(buckets.landBldg),
    condo: buildStats(buckets.condo),
    totalCount: records.length,
    municipality,
  };
}

// =============================================================
// 適正市場価格の推定（計算式を開示する）
// =============================================================

export interface FairValueResult {
  fairValue: number;
  /** 人間が読める計算式（UI・レポートにそのまま表示） */
  formula: string;
  /** 推定に使った分類 */
  basis: "land+building" | "landBldg" | "condo" | "none";
}

/**
 * 物件タイプに応じた適正市場価格を推定する。
 * @param landArea 土地面積㎡
 * @param buildingArea 延床㎡
 * @param buildingValue 建物の積算価値（円）… 土地事例ベース推定の建物分に使用
 */
export function estimateFairValue(
  m: MarketAnalysis,
  landArea: number,
  buildingArea: number,
  buildingValue: number
): FairValueResult {
  // 優先1: 土地のみ事例 × 土地面積 + 建物積算（土地値の実勢が最も信頼できる）
  if (m.land && m.land.count >= 3 && landArea > 0) {
    const fv = Math.round(m.land.medianUnitPrice * landArea + buildingValue);
    return {
      fairValue: fv,
      basis: "land+building",
      formula: `土地事例単価中央値 ${m.land.medianUnitPrice.toLocaleString()}円/㎡ × 土地${landArea}㎡ ＋ 建物積算 ${buildingValue.toLocaleString()}円（事例${m.land.count}件）`,
    };
  }
  // 優先2: 土地と建物の一体事例 × 土地面積（一棟・戸建ての総額相場）
  if (m.landBldg && m.landBldg.count >= 3 && landArea > 0) {
    const fv = Math.round(m.landBldg.medianUnitPrice * landArea);
    return {
      fairValue: fv,
      basis: "landBldg",
      formula: `土地建物一体事例の土地面積単価中央値 ${m.landBldg.medianUnitPrice.toLocaleString()}円/㎡ × 土地${landArea}㎡（事例${m.landBldg.count}件）`,
    };
  }
  // 優先3: 区分の専有単価 × 延床（区分マンションの場合）
  if (m.condo && m.condo.count >= 3 && buildingArea > 0) {
    const fv = Math.round(m.condo.medianUnitPrice * buildingArea);
    return {
      fairValue: fv,
      basis: "condo",
      formula: `中古マンション事例の専有単価中央値 ${m.condo.medianUnitPrice.toLocaleString()}円/㎡ × 専有${buildingArea}㎡（事例${m.condo.count}件）`,
    };
  }
  return { fairValue: 0, basis: "none", formula: "有効な事例が不足（3件未満）のため推定不可" };
}

export interface DeviationResult {
  askingPrice: number;
  fairValue: number;
  costValue: number;
  /** 対 適正市場価格の乖離率（%、プラス=割高） */
  vsFairPct: number;
  /** 対 積算価格の乖離率（%、プラス=割高） */
  vsCostPct: number;
  verdict: "discount" | "fair" | "premium";
  message: string;
}

/** 乖離率を算出する。プラス=売出が割高、マイナス=割安。 */
export function calcDeviation(
  askingPrice: number,
  fairValue: number,
  costValue: number
): DeviationResult {
  const vsFairPct = fairValue > 0 ? ((askingPrice - fairValue) / fairValue) * 100 : 0;
  const vsCostPct = costValue > 0 ? ((askingPrice - costValue) / costValue) * 100 : 0;

  let verdict: DeviationResult["verdict"];
  let message: string;
  if (vsFairPct <= -5) {
    verdict = "discount";
    message = `適正市場価格より約${Math.abs(vsFairPct).toFixed(1)}%割安。指値交渉せずとも妙味あり。`;
  } else if (vsFairPct >= 8) {
    verdict = "premium";
    message = `適正市場価格より約${vsFairPct.toFixed(1)}%割高。指値交渉または見送りを検討。`;
  } else {
    verdict = "fair";
    message = "概ね適正レンジ。個別要因（築年・立地・利回り）で最終判断を。";
  }
  return { askingPrice, fairValue, costValue, vsFairPct, vsCostPct, verdict, message };
}
