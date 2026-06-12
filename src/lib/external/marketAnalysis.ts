import type { TransactionRecord } from "./reinfolib";

// =============================================================
// マーケットアプローチ — 実勢価格の集計と乖離率の算出
// 取引事例（成約）から適正市場価格を推定し、売出価格との
// プレミアム/ディスカウントを% で可視化する。
// =============================================================

export interface MarketStats {
  /** 事例件数 */
  count: number;
  /** 単価中央値（円/㎡） */
  medianUnitPrice: number;
  /** 単価平均（円/㎡） */
  meanUnitPrice: number;
  /** 単価レンジ */
  minUnitPrice: number;
  maxUnitPrice: number;
  /** 推定適正市場価格（対象面積 × 単価中央値）（円） */
  estimatedFairValue: number;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * 取引事例から市場統計を算出する。
 * @param records 取引事例
 * @param targetArea 対象物件の面積（適正価格推定用、㎡）
 * @param filterUse 用途フィルタ（任意）
 */
export function analyzeMarket(
  records: TransactionRecord[],
  targetArea: number,
  filterUse?: string
): MarketStats {
  const filtered = records.filter((r) => {
    if (filterUse && r.use && !r.use.includes(filterUse)) return false;
    const up = unitPriceOf(r);
    return up != null && up > 0 && isFinite(up);
  });
  const ups = filtered.map((r) => unitPriceOf(r)!).filter((v) => v > 0);
  if (ups.length === 0) {
    return {
      count: 0,
      medianUnitPrice: 0,
      meanUnitPrice: 0,
      minUnitPrice: 0,
      maxUnitPrice: 0,
      estimatedFairValue: 0,
    };
  }
  const med = median(ups);
  const mean = ups.reduce((a, b) => a + b, 0) / ups.length;
  return {
    count: ups.length,
    medianUnitPrice: Math.round(med),
    meanUnitPrice: Math.round(mean),
    minUnitPrice: Math.round(Math.min(...ups)),
    maxUnitPrice: Math.round(Math.max(...ups)),
    estimatedFairValue: Math.round(med * targetArea),
  };
}

function unitPriceOf(r: TransactionRecord): number | null {
  if (r.unitPrice && r.unitPrice > 0) return r.unitPrice;
  if (r.price > 0 && r.area && r.area > 0) return r.price / r.area;
  return null;
}

export interface DeviationResult {
  /** 売出価格 */
  askingPrice: number;
  /** 適正市場価格 */
  fairValue: number;
  /** 積算（土地値）価格 */
  costValue: number;
  /** 対 適正市場価格の乖離率（%、プラス=割高） */
  vsFairPct: number;
  /** 対 積算価格の乖離率（%、プラス=割高） */
  vsCostPct: number;
  verdict: "discount" | "fair" | "premium";
  message: string;
}

/**
 * 乖離率を算出する。プラス=売出が割高、マイナス=割安。
 */
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
