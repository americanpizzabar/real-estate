import { describe, it, expect } from "vitest";
import { buildProjection, type ProjectionInput } from "../projection";
import { summarizePortfolio, type CatalogItem } from "@/lib/catalog";

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

describe("設備分離償却", () => {
  it("設備分離ありは初年度の減価償却が増える（早期節税）", () => {
    const noEquip = buildProjection({ ...base, equipmentRatio: 0 });
    const equip = buildProjection({ ...base, equipmentRatio: 0.25 });
    expect(equip.rows[0].depreciation).toBeGreaterThan(noEquip.rows[0].depreciation);
    // 初年度の税額は下がる（償却増で課税所得減）
    expect(equip.rows[0].tax).toBeLessThanOrEqual(noEquip.rows[0].tax);
  });

  it("equipmentRatio=0 は従来と同一（後方互換）", () => {
    const a = buildProjection({ ...base, equipmentRatio: 0 });
    const b = buildProjection(base);
    expect(a.rows[0].depreciation).toBe(b.rows[0].depreciation);
    expect(a.metrics.irrPct).toBe(b.metrics.irrPct);
  });

  it("設備割合は0.4で上限クランプ（暴走防止）", () => {
    const huge = buildProjection({ ...base, equipmentRatio: 0.9 });
    const capped = buildProjection({ ...base, equipmentRatio: 0.4 });
    expect(huge.rows[0].depreciation).toBe(capped.rows[0].depreciation);
  });
});

function item(over: Partial<CatalogItem["snapshot"]> & { price: number; kind?: any }): CatalogItem {
  return {
    id: Math.random().toString(36), createdAt: 0, status: "reviewing",
    property: {
      name: "x", address: "x", price: over.price, landArea: 100, buildingArea: 100,
      structure: "RC", builtYear: 2010, rosenkaPerSqm: 0, koujiPerSqm: 0, propertyKind: over.kind,
    },
    extras: {}, tags: [],
    snapshot: {
      landValueRatio: 0.5, grossYieldPct: over.grossYieldPct ?? 6, score: 70, grade: "A",
      price: over.price, noi: over.noi ?? 0, netYieldPct: over.netYieldPct ?? 4,
      btcf: over.btcf ?? 0, selfFunds: over.selfFunds ?? 0,
      loanAmount: over.loanAmount ?? 0, annualDebtService: over.annualDebtService ?? 0, dscr: over.dscr ?? 1.3,
    },
  };
}

describe("ポートフォリオ集計", () => {
  const items: CatalogItem[] = [
    item({ price: 60_000_000, noi: 3_000_000, loanAmount: 48_000_000, annualDebtService: 2_000_000, btcf: 1_000_000, selfFunds: 16_000_000, grossYieldPct: 6, netYieldPct: 5, kind: "アパート" } as any),
    item({ price: 40_000_000, noi: 2_400_000, loanAmount: 24_000_000, annualDebtService: 1_100_000, btcf: 1_300_000, selfFunds: 20_000_000, grossYieldPct: 7, netYieldPct: 6, kind: "マンション" } as any),
  ];

  it("合計・LTV・DSCR・加重利回りを正しく集計", () => {
    const s = summarizePortfolio(items);
    expect(s.count).toBe(2);
    expect(s.totalPrice).toBe(100_000_000);
    expect(s.totalLoan).toBe(72_000_000);
    expect(s.overallLtvPct).toBeCloseTo(72, 3);
    expect(s.totalNoi).toBe(5_400_000);
    expect(s.portfolioDscr).toBeCloseTo(5_400_000 / 3_100_000, 3);
    // 価格加重表面利回り = (6*60 + 7*40)/100 = 6.4
    expect(s.weightedGrossYieldPct).toBeCloseTo(6.4, 3);
  });

  it("種別構成を価格降順で集計", () => {
    const s = summarizePortfolio(items);
    expect(s.byKind[0].kind).toBe("アパート"); // 6000万 > 4000万
    expect(s.byKind.reduce((a, k) => a + k.count, 0)).toBe(2);
  });

  it("財務データ無しの古いスナップショットは財務集計から除外", () => {
    const legacy: CatalogItem = { ...items[0], snapshot: { landValueRatio: 0.5, grossYieldPct: 6, score: 70, grade: "A" } };
    const s = summarizePortfolio([legacy]);
    expect(s.withFinancials).toBe(0);
    expect(s.count).toBe(1);
    expect(s.totalPrice).toBe(0); // 財務集計は0
  });
});
