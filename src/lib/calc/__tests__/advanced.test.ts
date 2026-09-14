import { describe, it, expect } from "vitest";
import {
  nationalIncomeTax,
  individualTotalTax,
  propertyIncomeTax,
  marginalTaxRate,
} from "../tax";
import {
  runMonteCarlo,
  runTornado,
  optimalExit,
  ltvDscrSeries,
} from "../advanced";
import type { ProjectionInput } from "../projection";

describe("tax（個人累進）", () => {
  it("所得税速算: 500万→ 5,000,000×20%−427,500 = 572,500", () => {
    expect(nationalIncomeTax(5_000_000)).toBe(572_500);
  });
  it("課税所得0以下は0", () => {
    expect(nationalIncomeTax(0)).toBe(0);
    expect(individualTotalTax(-100)).toBe(0);
  });
  it("個人総税額 = 所得税×1.021 + 住民税10%", () => {
    const t = individualTotalTax(5_000_000);
    expect(t).toBeCloseTo(572_500 * 1.021 + 5_000_000 * 0.1, 0);
  });
  it("限界課税: 不動産所得ぶんは他所得帯で税率が上がる", () => {
    const lowBase = propertyIncomeTax(1_000_000, "individual", 0.33, 3_000_000);
    const highBase = propertyIncomeTax(1_000_000, "individual", 0.33, 20_000_000);
    expect(highBase).toBeGreaterThan(lowBase); // 高所得者ほど限界税率が高い
  });
  it("flatモードは実効税率そのまま", () => {
    expect(propertyIncomeTax(1_000_000, "flat", 0.33)).toBe(330_000);
  });
  it("限界税率: 高所得帯は45%系", () => {
    expect(marginalTaxRate("individual", 0.33, 50_000_000)).toBeGreaterThan(0.5);
  });
});

const base: ProjectionInput = {
  property: {
    name: "P", address: "東京", price: 60_000_000, landArea: 100, buildingArea: 140,
    structure: "RC", builtYear: 2010, rosenkaPerSqm: 350_000, koujiPerSqm: 0,
  },
  mode: "rental",
  rental: { monthlyGrossRent: 420_000, vacancyRatePct: 6, opexRatePct: 20, rentDeclinePctPerYear: 1 },
  loan: { amount: 48_000_000, annualRatePct: 2.0, years: 30, repayment: "equal-payment" },
  downPayment: 12_000_000, initialCostsTotal: 4_000_000, years: 15,
  taxRate: 0.33, discountRate: 0.04, exitYear: 15, exitCapRatePct: 6.5, currentYear: 2026,
};

describe("advanced（高度分析）", () => {
  it("モンテカルロ: 決定論的（同seedで再現）、分位が単調", () => {
    const a = runMonteCarlo(base, 300, 42);
    const b = runMonteCarlo(base, 300, 42);
    expect(a.percentiles.p50).toBe(b.percentiles.p50); // 再現性
    expect(a.percentiles.p10).toBeLessThanOrEqual(a.percentiles.p50);
    expect(a.percentiles.p50).toBeLessThanOrEqual(a.percentiles.p90);
    expect(a.probLossIRR).toBeGreaterThanOrEqual(0);
    expect(a.probLossIRR).toBeLessThanOrEqual(1);
    expect(a.histogram.reduce((s, h) => s + h.count, 0)).toBe(a.irrs.length);
  });

  it("トルネード: swing降順、金利/賃料/空室が主要ドライバー", () => {
    const { bars } = runTornado(base);
    expect(bars.length).toBeGreaterThan(2);
    for (let i = 1; i < bars.length; i++) {
      expect(bars[i - 1].swing).toBeGreaterThanOrEqual(bars[i].swing);
    }
  });

  it("最適出口: 年ごとにIRRを算出し最良年を返す", () => {
    const { points, bestYear } = optimalExit(base);
    expect(points.length).toBe(15);
    expect(bestYear).not.toBeNull();
    expect(bestYear).toBeGreaterThanOrEqual(1);
  });

  it("LTV/DSCR推移: LTVは返済で低下、DSCRは正", () => {
    const s = ltvDscrSeries(base);
    expect(s.length).toBe(15);
    expect(s[s.length - 1].ltv).toBeLessThan(s[0].ltv); // 返済でLTV低下
    expect(s[0].dscr).toBeGreaterThan(0);
  });

  it("個人課税モードはflatより税額が変わりIRRに影響", () => {
    const flat = runMonteCarlo({ ...base, taxMode: "flat" }, 100, 1);
    const indiv = runMonteCarlo({ ...base, taxMode: "individual", otherIncome: 8_000_000 }, 100, 1);
    expect(flat.percentiles.p50).not.toBe(indiv.percentiles.p50);
  });
});
