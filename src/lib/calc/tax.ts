// =============================================================
// 税務エンジン — 個人（累進）/ 法人（実効）の切替
// 不動産所得への課税を、個人は所得税累進＋住民税＋復興特別、
// 法人は実効税率で計算する。個人は「他の所得」に上乗せした
// 限界課税（marginal）で不動産所得ぶんの税額を求める。
// =============================================================

export type TaxMode = "flat" | "individual";

/** 所得税（国税）の速算: [課税所得上限, 税率, 控除額] （2024年基準） */
const NATIONAL_BRACKETS: [number, number, number][] = [
  [1_950_000, 0.05, 0],
  [3_300_000, 0.1, 97_500],
  [6_950_000, 0.2, 427_500],
  [9_000_000, 0.23, 636_000],
  [18_000_000, 0.33, 1_536_000],
  [40_000_000, 0.4, 2_796_000],
  [Infinity, 0.45, 4_796_000],
];

/** 所得税（国税）額。課税所得<=0は0。 */
export function nationalIncomeTax(taxableIncome: number): number {
  if (taxableIncome <= 0) return 0;
  for (const [cap, rate, deduction] of NATIONAL_BRACKETS) {
    if (taxableIncome <= cap) return Math.max(0, taxableIncome * rate - deduction);
  }
  return 0;
}

/**
 * 個人の総税額（所得税＋復興特別所得税2.1%＋住民税10%）。
 */
export function individualTotalTax(taxableIncome: number): number {
  if (taxableIncome <= 0) return 0;
  const national = nationalIncomeTax(taxableIncome);
  const reconstruction = national * 0.021; // 復興特別所得税
  const resident = taxableIncome * 0.1; // 住民税（概算10%）
  return national + reconstruction + resident;
}

/**
 * 不動産所得ぶんに課される税額を求める。
 * @param propertyTaxable 物件の課税所得（NOI - 利息 - 減価償却）。損失なら負。
 * @param mode "individual" は他所得に上乗せした限界課税、"flat" は実効税率
 * @param flatRate flat時の実効税率（0-1）
 * @param otherIncome individual時の他の課税所得（給与等）
 */
export function propertyIncomeTax(
  propertyTaxable: number,
  mode: TaxMode,
  flatRate: number,
  otherIncome = 0
): number {
  if (propertyTaxable <= 0) return 0; // 赤字は本ツールでは還付を見込まない（保守）
  if (mode === "flat") {
    return Math.round(propertyTaxable * flatRate);
  }
  // 個人: 限界税額 = T(他所得+不動産) - T(他所得)
  const withProp = individualTotalTax(otherIncome + propertyTaxable);
  const base = individualTotalTax(otherIncome);
  return Math.round(Math.max(0, withProp - base));
}

/**
 * 限界税率（表示用）。個人はotherIncome帯での限界税率、flatはflatRate。
 */
export function marginalTaxRate(
  mode: TaxMode,
  flatRate: number,
  otherIncome = 0
): number {
  if (mode === "flat") return flatRate;
  const d = 1_000_000;
  const rate = (individualTotalTax(otherIncome + d) - individualTotalTax(otherIncome)) / d;
  return rate;
}
