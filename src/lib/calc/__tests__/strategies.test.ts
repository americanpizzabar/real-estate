import { describe, it, expect } from "vitest";
import { buildAdvancedSchedule, compareLoanStrategies } from "../loanStrategy";
import { analyzeRealOptions, type RealOptionInput } from "../realOptions";
import { optimizePortfolio, type CatalogItem } from "@/lib/catalog";
import type { LoanInput } from "../types";

const loan: LoanInput = { amount: 48_000_000, annualRatePct: 2.0, years: 30, repayment: "equal-payment" };

describe("融資戦略 (#8)", () => {
  it("イベントなしは完済し残高0", () => {
    const r = buildAdvancedSchedule(loan, {});
    expect(r.rows.length).toBeGreaterThan(0);
    expect(r.rows[r.rows.length - 1].balanceEnd).toBe(0);
    expect(r.payoffYear).toBe(30);
  });
  it("借換え(低金利)で総支払利息が減る", () => {
    const base = buildAdvancedSchedule(loan, {});
    const refi = buildAdvancedSchedule(loan, { refinance: { year: 3, ratePct: 1.0, years: 27 } });
    expect(refi.totalInterest).toBeLessThan(base.totalInterest);
  });
  it("繰上返済(期間短縮)で完済が早まり利息減", () => {
    const base = buildAdvancedSchedule(loan, {});
    const pre = buildAdvancedSchedule(loan, { prepayment: { year: 3, amount: 10_000_000, mode: "shorten" } });
    expect(pre.payoffYear!).toBeLessThan(base.payoffYear!);
    expect(pre.totalInterest).toBeLessThan(base.totalInterest);
  });
  it("変動金利上昇で総利息が増える", () => {
    const base = buildAdvancedSchedule(loan, {});
    const up = buildAdvancedSchedule(loan, { ratePath: [{ year: 6, ratePct: 3 }, { year: 11, ratePct: 4 }] });
    expect(up.totalInterest).toBeGreaterThan(base.totalInterest);
  });
  it("compareLoanStrategiesはベースを含み節約額を返す", () => {
    const rows = compareLoanStrategies(loan, [
      { key: "refi", label: "借換え", events: { refinance: { year: 3, ratePct: 1, years: 27, feePct: 2.2 } } },
    ]);
    expect(rows[0].key).toBe("base");
    expect(rows.find((r) => r.key === "refi")).toBeTruthy();
  });
});

describe("リアルオプション (#11)", () => {
  const base: RealOptionInput = {
    currentNoi: 3_000_000, altNoi: 4_500_000, altLabel: "民泊", capRatePct: 6,
    landMarketValue: 50_000_000, buildingArea: 140, landArea: 100, structure: "RC",
    floorAreaRatioPct: 300, currentMonthlyRentPerSqm: 3000, price: 55_000_000,
  };
  it("最有効使用は最大価値の戦略", () => {
    const r = analyzeRealOptions(base);
    const maxVal = Math.max(...r.strategies.filter((s) => s.feasible).map((s) => s.value));
    expect(r.best.value).toBe(maxVal);
  });
  it("用途転換NOIが高いと転換が有力", () => {
    const r = analyzeRealOptions(base);
    const convert = r.strategies.find((s) => s.key === "convert");
    expect(convert).toBeTruthy();
    // altNoi(450万) > currentNoi(300万) → 転換価値 > 現況価値
    const cont = r.strategies.find((s) => s.key === "continue")!;
    expect(convert!.value).toBeGreaterThan(cont.value);
  });
  it("オプションプレミアム = 最有効 − 現況", () => {
    const r = analyzeRealOptions(base);
    const cont = r.strategies.find((s) => s.key === "continue")!;
    expect(r.optionPremium).toBe(r.best.value - cont.value);
  });
});

function pItem(name: string, price: number, kind: any, address: string, netYield: number, ltvPct: number): CatalogItem {
  return {
    id: name, createdAt: 0, status: "reviewing",
    property: { name, address, price, landArea: 100, buildingArea: 100, structure: "RC", builtYear: 2010, rosenkaPerSqm: 0, koujiPerSqm: 0, propertyKind: kind },
    extras: {}, tags: [],
    snapshot: { landValueRatio: 0.5, grossYieldPct: netYield + 1, score: 70, grade: "A", price, netYieldPct: netYield, loanAmount: price * (ltvPct / 100), noi: price * netYield / 100 },
  };
}

describe("ポートフォリオ最適化 (#12)", () => {
  it("同一種別・同一エリアは集中度HHIが高く分散スコア低い", () => {
    const items = [
      pItem("A", 50_000_000, "アパート", "東京都世田谷区桜", 5, 80),
      pItem("B", 50_000_000, "アパート", "東京都世田谷区桜", 5, 80),
    ];
    const o = optimizePortfolio(items);
    expect(o.hhiKind).toBeCloseTo(1, 2); // 全て同種別
    expect(o.diversificationScore).toBeLessThan(40);
    expect(o.suggestions.join()).toMatch(/集中|分散/);
  });
  it("種別・エリアが分かれると分散スコアが上がる", () => {
    const conc = optimizePortfolio([
      pItem("A", 50_000_000, "アパート", "東京都世田谷区桜", 5, 70),
      pItem("B", 50_000_000, "アパート", "東京都世田谷区桜", 5, 70),
    ]);
    const div = optimizePortfolio([
      pItem("A", 50_000_000, "アパート", "東京都世田谷区桜", 5, 70),
      pItem("B", 50_000_000, "マンション", "大阪府大阪市北区", 6, 70),
    ]);
    expect(div.diversificationScore).toBeGreaterThan(conc.diversificationScore);
  });
  it("リスク・リターン点を全物件ぶん返す", () => {
    const items = [pItem("A", 50_000_000, "アパート", "東京都", 5, 70), pItem("B", 40_000_000, "区分", "大阪府", 6, 60)];
    expect(optimizePortfolio(items).riskReturn.length).toBe(2);
  });
});
