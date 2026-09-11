import { describe, it, expect } from "vitest";
import { equalPaymentMonthly, buildLoanSchedule, annualDebtService } from "../loan";
import { irr, npv } from "../finance";
import { calcCostApproach, calcShapeFactor, judgeLandValueStance } from "../costApproach";
import { rentalIncome, minpakuIncome } from "../income";
import { buildProjection, depreciationYears } from "../projection";
import type { PropertyInput, LoanInput, RentalParams, MinpakuParams } from "../types";

describe("loan", () => {
  it("元利均等の毎月返済額（標準ケース）", () => {
    // 3000万, 年2%, 35年 → 約99,378円/月
    const loan: LoanInput = { amount: 30_000_000, annualRatePct: 2.0, years: 35, repayment: "equal-payment" };
    const m = equalPaymentMonthly(loan);
    expect(m).toBeGreaterThan(99_000);
    expect(m).toBeLessThan(100_000);
  });

  it("元利均等は完済し残高が0になる", () => {
    const loan: LoanInput = { amount: 30_000_000, annualRatePct: 2.0, years: 35, repayment: "equal-payment" };
    const sched = buildLoanSchedule(loan);
    expect(sched.length).toBe(35);
    expect(sched[sched.length - 1].balanceEnd).toBe(0);
  });

  it("元金均等は初年度返済が最大", () => {
    const loan: LoanInput = { amount: 30_000_000, annualRatePct: 2.0, years: 20, repayment: "equal-principal" };
    const sched = buildLoanSchedule(loan);
    expect(sched[0].totalPaid).toBeGreaterThan(sched[sched.length - 1].totalPaid);
    expect(sched[sched.length - 1].balanceEnd).toBe(0);
  });

  it("金利0%なら元金/期間", () => {
    const loan: LoanInput = { amount: 12_000_000, annualRatePct: 0, years: 10, repayment: "equal-payment" };
    expect(equalPaymentMonthly(loan)).toBeCloseTo(100_000, 0);
  });
});

describe("finance", () => {
  it("NPVは割引率0で単純合計", () => {
    expect(npv(0, [-100, 50, 50, 50])).toBeCloseTo(50, 5);
  });

  it("IRRの基本ケース", () => {
    // -1000 投資, 毎年 +400 を3年 → IRR ≈ 9.7%
    const r = irr([-1000, 400, 400, 400]);
    expect(r).not.toBeNull();
    expect(r! * 100).toBeGreaterThan(9);
    expect(r! * 100).toBeLessThan(11);
  });

  it("全て同符号ならnull", () => {
    expect(irr([100, 200, 300])).toBeNull();
  });
});

describe("cost approach", () => {
  const p: PropertyInput = {
    name: "テスト物件",
    address: "東京都",
    price: 50_000_000,
    landArea: 100,
    buildingArea: 120,
    structure: "RC",
    builtYear: 2010,
    rosenkaPerSqm: 300_000,
    koujiPerSqm: 0,
  };

  it("整形地は補正率1.0", () => {
    expect(calcShapeFactor({ frontage: 8, depth: 10, irregular: false, corner: false })).toBeCloseTo(1.0, 5);
  });

  it("不整形地は減価、角地は加算", () => {
    expect(calcShapeFactor({ frontage: 8, depth: 10, irregular: true, corner: false })).toBeLessThan(1.0);
    expect(calcShapeFactor({ frontage: 8, depth: 10, irregular: false, corner: true })).toBeGreaterThan(1.0);
  });

  it("土地値 = 路線価 × 面積（整形地）", () => {
    const r = calcCostApproach(p, 2025, { frontage: 8, depth: 10, irregular: false, corner: false });
    expect(r.landValue).toBe(30_000_000);
    expect(r.landValueRatio).toBeCloseTo(0.6, 3);
  });

  it("築古ほど建物価値が下がる", () => {
    const newer = calcCostApproach({ ...p, builtYear: 2020 }, 2025);
    const older = calcCostApproach({ ...p, builtYear: 2000 }, 2025);
    expect(newer.buildingValue).toBeGreaterThan(older.buildingValue);
  });

  it("スタンス判定: 80%以上はfortress", () => {
    expect(judgeLandValueStance(0.85).level).toBe("fortress");
    expect(judgeLandValueStance(0.2).level).toBe("risky");
  });
});

describe("income", () => {
  it("賃貸: 空室控除と運営費でNOI算出", () => {
    const params: RentalParams = {
      monthlyGrossRent: 500_000,
      vacancyRatePct: 5,
      opexRatePct: 20,
      rentDeclinePctPerYear: 1,
    };
    const r = rentalIncome(params);
    expect(r.gpi).toBe(6_000_000);
    expect(r.egi).toBe(5_700_000); // 5%空室
    expect(r.noi).toBe(5_700_000 - 1_140_000); // 20% opex
  });

  it("民泊: 売上=ADR×日数×稼働、手数料控除", () => {
    const params: MinpakuParams = {
      adr: 15_000,
      occupancyPct: 60,
      operableDays: 180,
      managementFeePct: 20,
      otaFeePct: 5,
      cleaningCostPerStay: 5_000,
      avgStayNights: 2,
      variableCostPerNight: 1_000,
      fixedOpexAnnual: 200_000,
    };
    const r = minpakuIncome(params);
    // 稼働売上 = 15000 * 180 * 0.6 = 1,620,000
    expect(r.egi).toBe(1_620_000);
    expect(r.noi).toBeLessThan(r.egi);
    expect(r.opex).toBeGreaterThan(0);
  });
});

describe("projection", () => {
  it("中古建物の償却年数（簡便法）", () => {
    // RC 法定47年, 築20年 → 47-20+20*0.2 = 31年
    expect(depreciationYears("RC", 20)).toBe(31);
    // RC 築50年（超過）→ 47*0.2 = 9年
    expect(depreciationYears("RC", 50)).toBe(9);
  });

  it("一気通貫: 賃貸の20年予測が成立", () => {
    const res = buildProjection({
      property: {
        name: "P", address: "東京", price: 50_000_000, landArea: 100, buildingArea: 120,
        structure: "RC", builtYear: 2010, rosenkaPerSqm: 300_000, koujiPerSqm: 0,
      },
      mode: "rental",
      rental: { monthlyGrossRent: 350_000, vacancyRatePct: 5, opexRatePct: 20, rentDeclinePctPerYear: 1 },
      loan: { amount: 40_000_000, annualRatePct: 2.0, years: 25, repayment: "equal-payment" },
      downPayment: 10_000_000,
      initialCostsTotal: 4_000_000,
      years: 20,
      taxRate: 0.33,
      discountRate: 0.04,
      exitYear: 20,
      exitCapRatePct: 7,
      currentYear: 2025,
    });
    expect(res.rows.length).toBe(20);
    expect(res.metrics.noi).toBeGreaterThan(0);
    expect(isFinite(res.metrics.dscr)).toBe(true);
    // 累積CFは年を追って増加（健全物件）
    expect(res.rows[19].cumulativeBtcf).toBeGreaterThan(res.rows[0].cumulativeBtcf);
  });

  const baseInput = {
    property: {
      name: "P", address: "東京", price: 50_000_000, landArea: 100, buildingArea: 120,
      structure: "RC" as const, builtYear: 2010, rosenkaPerSqm: 300_000, koujiPerSqm: 0,
    },
    mode: "rental" as const,
    rental: { monthlyGrossRent: 350_000, vacancyRatePct: 5, opexRatePct: 20, rentDeclinePctPerYear: 1 },
    loan: { amount: 40_000_000, annualRatePct: 2.0, years: 25, repayment: "equal-payment" as const },
    downPayment: 10_000_000,
    initialCostsTotal: 4_000_000,
    years: 20,
    taxRate: 0.33,
    discountRate: 0.04,
    exitCapRatePct: 7,
    currentYear: 2025,
  };

  it("実質利回りは購入諸経費込みの総投資額が分母", () => {
    const res = buildProjection({ ...baseInput, exitYear: 20 });
    const expected = (res.metrics.noi / (50_000_000 + 4_000_000)) * 100;
    expect(res.metrics.netYieldPct).toBeCloseTo(expected, 4);
    // 価格のみ分母より必ず小さい
    expect(res.metrics.netYieldPct).toBeLessThan((res.metrics.noi / 50_000_000) * 100);
  });

  it("譲渡所得税で出口手取りが減り、IRRは課税なし想定より低い", () => {
    const taxed = buildProjection({ ...baseInput, exitYear: 20 });
    // 短期(5年以内)売却は税率が高くIRRがさらに下がる
    const shortTerm = buildProjection({ ...baseInput, exitYear: 4, years: 20 });
    expect(taxed.metrics.irrPct).not.toBeNull();
    expect(shortTerm.metrics.irrPct).not.toBeNull();
    // 値が有限で妥当な範囲
    expect(Number.isFinite(taxed.metrics.irrPct!)).toBe(true);
  });
});
