import type {
  PropertyInput,
  ShapeCorrection,
  CostApproachResult,
} from "./types";
import {
  LEGAL_LIFESPAN,
  REPLACEMENT_UNIT_COST,
  LIQUIDITY_MULTIPLIER,
} from "./constants";

// =============================================================
// 積算価格（コストアプローチ）算出
// 土地: 路線価ベース ± 画地補正、実勢流動性価格も併算
// 建物: 再調達原価 × 残存年数/法定耐用年数
// =============================================================

/**
 * 画地補正率を簡易計算する。
 * 国税庁の財産評価基本通達を簡略化した実務向けモデル。
 * 1.0 を基準に、間口狭小・奥行長大・不整形で減価、角地で加算。
 */
export function calcShapeFactor(c: ShapeCorrection): number {
  let factor = 1.0;

  // 間口狭小補正（4m未満で減価）
  if (c.frontage > 0) {
    if (c.frontage < 4) factor *= 0.9;
    else if (c.frontage < 6) factor *= 0.97;
  }

  // 奥行長大／極端な細長地の補正（奥行/間口比）
  if (c.frontage > 0 && c.depth > 0) {
    const ratio = c.depth / c.frontage;
    if (ratio > 4) factor *= 0.9;
    else if (ratio > 3) factor *= 0.95;
    // 奥行が極端に短い（接道だけで使いにくい）場合も軽い減価
    if (c.depth < 5) factor *= 0.95;
  }

  // 不整形地補正
  if (c.irregular) factor *= 0.85;

  // 角地加算（側方路線影響加算の簡易版）
  if (c.corner) factor *= 1.05;

  // 補正率は 0.6〜1.1 にクランプ（暴走防止）
  return Math.max(0.6, Math.min(1.1, factor));
}

/** デフォルトの画地補正（補正なし、整形地・標準間口）。 */
export const DEFAULT_SHAPE: ShapeCorrection = {
  frontage: 6,
  depth: 12,
  irregular: false,
  corner: false,
};

/**
 * 積算価格を算出する。
 * @param p 物件情報
 * @param currentYear 評価基準年（残存年数算出に使用）
 * @param shape 画地補正パラメータ
 * @param overrides 単価等の上書き（UI調整用）
 */
export function calcCostApproach(
  p: PropertyInput,
  currentYear: number,
  shape: ShapeCorrection = DEFAULT_SHAPE,
  overrides?: {
    replacementUnitCost?: number;
    legalLifespan?: number;
    liquidityMultiplier?: number;
  }
): CostApproachResult {
  // --- 土地 ---
  const rosenka = p.rosenkaPerSqm > 0 ? p.rosenkaPerSqm : 0;
  const landValueRaw = rosenka * p.landArea;
  const shapeFactor = calcShapeFactor(shape);
  const landValue = Math.round(landValueRaw * shapeFactor);

  const liquidity = overrides?.liquidityMultiplier ?? LIQUIDITY_MULTIPLIER;
  // 実勢流動性価格は補正後土地額に流動性倍率。公示地価があればそれも加味（高い方を採用しすぎないよう平均）。
  let landMarketValue = Math.round(landValue * liquidity);
  if (p.koujiPerSqm > 0) {
    const koujiBased = Math.round(p.koujiPerSqm * p.landArea * shapeFactor);
    // 路線価実勢と公示ベースの平均を採用（乖離を均す）
    landMarketValue = Math.round((landMarketValue + koujiBased) / 2);
  }

  // --- 建物 ---
  const legalLifespan =
    overrides?.legalLifespan ?? LEGAL_LIFESPAN[p.structure];
  const unitCost =
    overrides?.replacementUnitCost ?? REPLACEMENT_UNIT_COST[p.structure];
  const buildingReplacementCost = Math.round(unitCost * p.buildingArea);

  const age = Math.max(0, currentYear - p.builtYear);
  const remainingYears = Math.max(0, legalLifespan - age);
  const buildingValue =
    legalLifespan > 0
      ? Math.round(buildingReplacementCost * (remainingYears / legalLifespan))
      : 0;

  // --- 合算 ---
  const totalCostValue = landValue + buildingValue;
  const landValueRatio = p.price > 0 ? landValue / p.price : 0;
  const costValueRatio = p.price > 0 ? totalCostValue / p.price : 0;

  return {
    landValue,
    landValueRaw: Math.round(landValueRaw),
    shapeFactor,
    landMarketValue,
    buildingReplacementCost,
    buildingValue,
    remainingYears,
    legalLifespan,
    totalCostValue,
    landValueRatio,
    costValueRatio,
  };
}

/**
 * 土地値比率に応じたプロのスタンス判定。
 * 出口戦略（売却）の自動判定ロジック。
 */
export function judgeLandValueStance(landValueRatio: number): {
  level: "fortress" | "balanced" | "income" | "risky";
  label: string;
  message: string;
  color: string;
} {
  const pct = landValueRatio * 100;
  if (pct >= 80) {
    return {
      level: "fortress",
      label: "資産防衛型（極めて安全）",
      color: "#2dd4a7",
      message:
        "土地値比率80%以上。建物が老朽化しても資産価値が落ちにくく、下値が堅い。融資評価も出やすく、出口（売却・更地化）も柔軟。",
    };
  }
  if (pct >= 50) {
    return {
      level: "balanced",
      label: "バランス型",
      color: "#4f9cf9",
      message:
        "土地値比率50〜80%。資産性と収益性のバランスが良好。長期保有・売却どちらの出口も選択可能。",
    };
  }
  if (pct >= 30) {
    return {
      level: "income",
      label: "インカム型",
      color: "#f5b14c",
      message:
        "土地値比率30〜50%。収益（利回り）重視の物件。建物価値に依存するため、運営力と出口時期の見極めが重要。",
    };
  }
  return {
    level: "risky",
    label: "高利回り・出口注意",
    color: "#f56c6c",
    message:
      "土地値比率30%以下。利回りは高いが将来の融資評価が出にくく、出口は更地化より実需（実住）向け転売を想定すべき。",
  };
}
