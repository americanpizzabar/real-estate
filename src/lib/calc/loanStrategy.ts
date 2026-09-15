import type { LoanInput, LoanYearRow } from "./types";

// =============================================================
// 融資戦略シミュレーション
//  - 変動金利パス（年ごとに金利が変わる）
//  - 借換え（残債を新条件で組み直し）
//  - 繰上返済（一括：期間短縮 or 返済額軽減）
// 元利均等/元金均等の月次シミュレーション。
// =============================================================

export interface RatePathPoint {
  /** この年から適用する金利(%) */
  year: number;
  ratePct: number;
}
export interface RefinanceEvent {
  year: number;
  ratePct: number;
  years: number; // 借換え後の残り年数
  feePct?: number; // 借換え手数料（残債に対する%）
}
export interface PrepaymentEvent {
  year: number;
  amount: number; // 一括繰上額（円）
  mode: "shorten" | "reduce"; // 期間短縮 / 返済額軽減
}
export interface LoanEvents {
  ratePath?: RatePathPoint[];
  refinance?: RefinanceEvent;
  prepayment?: PrepaymentEvent;
}

/** 元利均等の毎月返済額（残債・年利%・残月数から）。 */
function annuity(balance: number, annualRatePct: number, months: number): number {
  const r = annualRatePct / 100 / 12;
  if (months <= 0) return balance;
  if (r === 0) return balance / months;
  return (balance * r) / (1 - Math.pow(1 + r, -months));
}

export interface AdvancedScheduleResult {
  rows: LoanYearRow[];
  totalInterest: number;
  payoffYear: number | null; // 完済年（events考慮後）
  refinanceFee: number;
}

/**
 * イベント（金利パス・借換え・繰上）を織り込んだ償却スケジュール。
 * eventsが空なら通常の元利均等/元金均等と一致。
 */
export function buildAdvancedSchedule(
  loan: LoanInput,
  events: LoanEvents = {}
): AdvancedScheduleResult {
  const rows: LoanYearRow[] = [];
  if (loan.amount <= 0 || loan.years <= 0) {
    return { rows, totalInterest: 0, payoffYear: null, refinanceFee: 0 };
  }
  const ratePath = [...(events.ratePath ?? [])].sort((a, b) => a.year - b.year);
  const rateForYear = (year: number): number => {
    let rate = loan.annualRatePct;
    for (const p of ratePath) if (year >= p.year) rate = p.ratePct;
    return rate;
  };

  let balance = loan.amount;
  let curRate = loan.annualRatePct;
  let monthsRemaining = loan.years * 12;
  let pmt = annuity(balance, curRate, monthsRemaining);
  const fixedPrincipal = loan.amount / (loan.years * 12); // 元金均等
  let totalInterest = 0;
  let refinanceFee = 0;
  let payoffMonth: number | null = null;

  const maxMonths = loan.years * 12 + 1;
  let yearPrincipal = 0;
  let yearInterest = 0;

  for (let m = 1; m <= maxMonths && balance > 0.5; m++) {
    const year = Math.ceil(m / 12);
    const monthInYear = ((m - 1) % 12) + 1;

    // 年初イベント: 金利変更 / 借換え
    if (monthInYear === 1) {
      const newRate = rateForYear(year);
      if (newRate !== curRate) {
        curRate = newRate;
        if (loan.repayment === "equal-payment")
          pmt = annuity(balance, curRate, monthsRemaining); // 変動: 残月で再計算
      }
      const refi = events.refinance;
      if (refi && refi.year === year && balance > 0) {
        refinanceFee += Math.round(balance * ((refi.feePct ?? 0) / 100));
        curRate = refi.ratePct;
        monthsRemaining = refi.years * 12;
        pmt = annuity(balance, curRate, monthsRemaining);
      }
    }

    const r = curRate / 100 / 12;
    const interest = balance * r;
    let principal =
      loan.repayment === "equal-payment" ? pmt - interest : fixedPrincipal;
    if (principal > balance) principal = balance;
    if (principal < 0) principal = 0;

    balance -= principal;
    monthsRemaining--;
    yearPrincipal += principal;
    yearInterest += interest;
    totalInterest += interest;

    // 年末イベント: 繰上返済
    const pre = events.prepayment;
    if (pre && pre.year === year && monthInYear === 12 && balance > 0) {
      const amt = Math.min(pre.amount, balance);
      balance -= amt;
      yearPrincipal += amt;
      if (pre.mode === "reduce" && loan.repayment === "equal-payment") {
        pmt = annuity(balance, curRate, monthsRemaining); // 返済額軽減
      }
      // shorten は pmt 据置 → 完済が早まる
    }

    if (balance <= 0.5 && payoffMonth === null) payoffMonth = m;

    if (monthInYear === 12 || balance <= 0.5 || m === maxMonths) {
      rows.push({
        year,
        principalPaid: Math.round(yearPrincipal),
        interestPaid: Math.round(yearInterest),
        totalPaid: Math.round(yearPrincipal + yearInterest),
        balanceEnd: Math.round(Math.max(0, balance)),
      });
      yearPrincipal = 0;
      yearInterest = 0;
    }
  }

  return {
    rows,
    totalInterest: Math.round(totalInterest),
    payoffYear: payoffMonth ? Math.ceil(payoffMonth / 12) : null,
    refinanceFee,
  };
}

export interface StrategyComparison {
  key: string;
  label: string;
  totalInterest: number;
  payoffYear: number | null;
  refinanceFee: number;
  /** ベースとの利息＋手数料の差（マイナス=節約） */
  savingVsBase: number;
}

/** ベース vs 施策 の比較。 */
export function compareLoanStrategies(
  loan: LoanInput,
  scenarios: { key: string; label: string; events: LoanEvents }[]
): StrategyComparison[] {
  const base = buildAdvancedSchedule(loan, {});
  const baseCost = base.totalInterest;
  const out: StrategyComparison[] = [
    { key: "base", label: "現状維持", totalInterest: base.totalInterest, payoffYear: base.payoffYear, refinanceFee: 0, savingVsBase: 0 },
  ];
  for (const s of scenarios) {
    const res = buildAdvancedSchedule(loan, s.events);
    const cost = res.totalInterest + res.refinanceFee;
    out.push({
      key: s.key,
      label: s.label,
      totalInterest: res.totalInterest,
      payoffYear: res.payoffYear,
      refinanceFee: res.refinanceFee,
      savingVsBase: cost - baseCost,
    });
  }
  return out;
}
