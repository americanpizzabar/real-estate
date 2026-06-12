import type { CostApproachResult, InvestmentMetrics } from "./types";

// =============================================================
// 「一撃判定」スコアリング（レーダーチャート用）
// 各軸 0〜100 で正規化し、総合スコアを算出する。
// =============================================================

export interface ScoreAxes {
  /** 積算評価（積算価格/価格） */
  costValue: number;
  /** 土地値比率（保全性） */
  landSafety: number;
  /** 収益性（実質利回り） */
  profitability: number;
  /** 融資妥当性（DSCR） */
  financeability: number;
  /** 市場乖離（割安度） */
  marketGap: number;
  /** キャッシュ効率（CCR） */
  cashEfficiency: number;
}

export interface ScoreResult {
  axes: ScoreAxes;
  total: number; // 総合 0〜100
  grade: "S" | "A" | "B" | "C" | "D";
  comment: string;
}

function clamp(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)));
}

/**
 * 各指標を 0〜100 のスコアに変換。
 * @param marketGapPct 売出価格に対する適正価格の乖離率（プラス=割安）
 */
export function computeScore(
  cost: CostApproachResult,
  metrics: InvestmentMetrics,
  marketGapPct: number | null
): ScoreResult {
  // 積算評価率: 100%で満点、80%で80点相当（線形）
  const costValue = clamp(cost.costValueRatio * 100);

  // 土地値比率: 80%以上で満点
  const landSafety = clamp((cost.landValueRatio / 0.8) * 100);

  // 収益性: 実質利回り 8%で満点、4%で50点
  const profitability = clamp((metrics.netYieldPct / 8) * 100);

  // 融資妥当性: DSCR 1.5で満点、1.0で33点
  const dscr = isFinite(metrics.dscr) ? metrics.dscr : 2.0;
  const financeability = clamp(((dscr - 0.8) / (1.5 - 0.8)) * 100);

  // 市場乖離: +20%割安で満点、0%で50点、割高でマイナス側
  const marketGap =
    marketGapPct === null ? 50 : clamp(50 + (marketGapPct / 20) * 50);

  // キャッシュ効率: CCR 10%で満点
  const cashEfficiency = clamp((metrics.ccr / 10) * 100);

  const axes: ScoreAxes = {
    costValue,
    landSafety,
    profitability,
    financeability,
    marketGap,
    cashEfficiency,
  };

  // 加重平均（保全性と融資妥当性をやや重視＝プロのスタンス）
  const total = clamp(
    costValue * 0.15 +
      landSafety * 0.25 +
      profitability * 0.2 +
      financeability * 0.2 +
      marketGap * 0.1 +
      cashEfficiency * 0.1
  );

  let grade: ScoreResult["grade"];
  if (total >= 85) grade = "S";
  else if (total >= 70) grade = "A";
  else if (total >= 55) grade = "B";
  else if (total >= 40) grade = "C";
  else grade = "D";

  const comment = buildComment(grade, axes);

  return { axes, total, grade, comment };
}

function buildComment(grade: ScoreResult["grade"], axes: ScoreAxes): string {
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const map: [keyof ScoreAxes, string][] = [
    ["landSafety", "土地値比率（資産保全）"],
    ["profitability", "収益性"],
    ["financeability", "融資妥当性"],
    ["costValue", "積算評価"],
    ["marketGap", "市場割安度"],
    ["cashEfficiency", "自己資金効率"],
  ];
  for (const [k, label] of map) {
    if (axes[k] >= 75) strengths.push(label);
    if (axes[k] <= 35) weaknesses.push(label);
  }
  let base = "";
  if (grade === "S") base = "極めて優良な投資対象。";
  else if (grade === "A") base = "優良な投資対象。";
  else if (grade === "B") base = "条件次第で検討に値する。";
  else if (grade === "C") base = "慎重な検討が必要。";
  else base = "投資妙味は限定的。";

  const s = strengths.length ? `強み: ${strengths.join("・")}。` : "";
  const w = weaknesses.length ? `留意点: ${weaknesses.join("・")}。` : "";
  return `${base}${s}${w}`;
}
